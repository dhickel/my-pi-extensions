"""Audit63 regressions; isolated synthetic boundaries, NEVER artwork approval."""
from copy import deepcopy
import fcntl
import json
import os
from pathlib import Path
import signal
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from test_core import copy_fixture, inspect, trust_record, build
from tileset_lab import drawcases, review, validate
from tileset_lab.manifest import Blocked, Inputs, Root, json_bytes, load_manifest, parse_json, sha256
from tileset_lab.report import check_report

PACKAGE = Path(__file__).resolve().parents[2]
ENV = {**os.environ, 'PYTHONPATH': str(PACKAGE/'python'), 'PYTHONDONTWRITEBYTECODE': '1'}
SELECT_WORKER = r'''
import json,os,signal,sys
from pathlib import Path
from tileset_lab import review
from tileset_lab.manifest import Root
from tileset_lab.native import invocation_group,Cancelled
path,kind,previous,signum=sys.argv[1:]
root=Root(path);previous=previous=='yes';signum=int(signum)
selector='outputs/approved-selector.json';old=b'OLD exact bytes\n';desired=b'NEW exact bytes\n'
if previous:root.write(selector,old)
root.write('outputs/previous-approved/art.bin',b'OLD immutable artwork')
original=review.os.replace;calls=0;facts={};foreign=None
try:
 with invocation_group():
  with root.lock():
   def check():
    global calls,foreign
    calls+=1
    if kind=='staging' and calls==1:
     stage=next((root.path/'outputs').glob('.selector-*.json'))
     before=stage.stat().st_ino;stage.write_bytes(b'ALTERED same inode\n')
     facts['same_inode']=stage.stat().st_ino==before
    if kind=='foreign' and calls==2:
     p=root.path/'outputs/foreign-identical.json';p.write_bytes(desired)
     foreign=p.stat().st_ino;original(p,root.path/selector)
     raise OSError('TEST-ONLY late failure after foreign replacement')
   def replace(src,dst,**kw):
    original(src,dst,**kw)
    if kind=='signal' and str(src).startswith('.selector-'):
     facts['real_rename_completed']=True
     os.kill(os.getpid(),signum)
   review.os.replace=replace
   try:review.select_exact(root,selector,desired,check,lambda:facts.update(finalizer_reached=True))
   except BaseException as e:facts['error']=type(e).__name__+': '+str(e)
   facts.update(selector_exists=root.exists(selector),foreign_inode=foreign)
   if root.exists(selector):facts.update(selector=root.read(selector)[0].decode(),inode=(root.path/selector).stat().st_ino)
   facts['art_preserved']=root.read('outputs/previous-approved/art.bin')[0]==b'OLD immutable artwork'
finally:root.close()
print(json.dumps(facts))
'''

# TERM-resistant descendant injects REAL TERM during finish_report settlement.
LOCK_WORKER = r'''
import os,sys,subprocess,time
from pathlib import Path
from tileset_lab import __main__,native
root=Path(sys.argv[1]);original=native.settle_owned;first=True
code=r"""
import fcntl,os,signal,sys,time,json
from pathlib import Path
root=Path(sys.argv[1]);parent=int(sys.argv[2]);count=0
(root/'descendant.pid').write_text(str(os.getpid()))
def term(*_):
 global count
 count+=1
 fd=os.open(root/'.tileset-lab.lock',os.O_RDWR)
 try:
  try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);state='UNSAFE_UNLOCKED'
  except BlockingIOError:state='BLOCKED_BY_TRANSACTION'
 finally:os.close(fd)
 with (root/'lock-events.jsonl').open('a') as f:f.write(json.dumps({'term':count,'lock':state})+'\n')
 if count==1:os.kill(parent,signal.SIGTERM)
signal.signal(signal.SIGTERM,term)
(root/'descendant.ready').write_text('READY')
while True:time.sleep(.01)
"""
def settlement():
 global first
 if first:
  first=False
  child=subprocess.Popen([sys.executable,'-c',code,str(root),str(os.getpid())],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  native._CHILDREN.add(child)
  deadline=time.monotonic()+10
  while not (root/'descendant.ready').exists():
   if time.monotonic()>deadline:raise ValueError('TEST-ONLY readiness failed')
   time.sleep(.01)
 return original()
native.settle_owned=settlement
raise SystemExit(__main__.main(['inspect','--project-root',str(root),'--manifest','manifest.json','--inspection-id','settlement-current','--initialize-inventory']))
'''


def group_members(pgid):
    members = []
    for path in Path('/proc').glob('[0-9]*/stat'):
        try:
            if int(path.read_text().rsplit(')', 1)[1].split()[2]) == pgid:
                members.append(int(path.parent.name))
        except (OSError, ValueError, IndexError):
            pass
    return members


class SelectionAndTerminalRepairs(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='phase02-audit63-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)

    def worker(self, kind, previous, signum=signal.SIGTERM):
        path = self.base/f'{kind}-{previous}-{signum}'
        path.mkdir()
        result = subprocess.run([sys.executable, '-W', 'error::ResourceWarning', '-c', SELECT_WORKER,
                                 str(path), kind, 'yes' if previous else 'no', str(int(signum))],
                                env=ENV, cwd='/tmp', capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        facts = parse_json(result.stdout, 'TEST-ONLY isolated selection control')
        self.assertTrue(facts['art_preserved'])
        return facts

    def test_real_rename_then_int_term_cancellation_restores_existing_or_absent_selector(self):
        for previous in (True, False):
            for sig in (signal.SIGINT, signal.SIGTERM):
                facts = self.worker('signal', previous, sig)
                self.assertTrue(facts['real_rename_completed'])
                self.assertTrue(facts['error'].startswith('Cancelled:'))
                self.assertNotIn('finalizer_reached', facts)
                self.assertEqual(facts['selector_exists'], previous)
                if previous:self.assertEqual(facts['selector'], 'OLD exact bytes\n')

    def test_same_inode_staging_edit_is_not_selected_or_finalized(self):
        for previous in (True, False):
            facts = self.worker('staging', previous)
            self.assertTrue(facts['same_inode'])
            self.assertIn('staging', facts['error'])
            self.assertNotIn('finalizer_reached', facts)
            self.assertEqual(facts['selector_exists'], previous)
            if previous:self.assertEqual(facts['selector'], 'OLD exact bytes\n')

    def test_pinned_staging_inode_corruption_inside_real_rename_window_is_recovered(self):
        for previous in (True, False):
            path = self.base/f'corrupt-rename-{previous}';path.mkdir()
            root = Root(path)
            try:
                selector='outputs/approved-selector.json'
                if previous:root.write(selector,b'OLD')
                original=os.replace
                def replace(src,dst,**kw):
                    if str(src).startswith('.selector-'):
                        (path/'outputs'/str(src)).write_bytes(b'TEST-ONLY same-inode corruption after precheck')
                    return original(src,dst,**kw)
                with root.lock(), patch.object(review.os,'replace',replace):
                    with self.assertRaisesRegex(Blocked,'content/identity differs'):
                        review.select_exact(root,selector,b'NEW',lambda:None)
                self.assertEqual(root.exists(selector),previous)
                if previous:self.assertEqual(root.read(selector)[0],b'OLD')
            finally:root.close()

    def test_finalizer_corruption_rejected_and_recovered_before_any_delivery(self):
        root=Root(self.base)
        self.addCleanup(root.close)
        selector='outputs/approved-selector.json';root.write(selector,b'OLD')
        deliveries=[]
        def finalize():
            (self.base/selector).write_bytes(b'TEST-ONLY changed during preparation')
            return 'NOT delivered'
        with root.lock():
            with self.assertRaisesRegex(Blocked,'during finalization'):
                review.select_exact(root,selector,b'NEW',lambda:None,finalize,deliveries.append)
        self.assertEqual(root.read(selector)[0],b'OLD')
        self.assertEqual(deliveries,[])

    def test_foreign_same_byte_selector_inode_is_preserved_not_rolled_back(self):
        for previous in (True, False):
            facts = self.worker('foreign', previous)
            self.assertIn('ownership uncertain', facts['error'])
            self.assertEqual(facts['inode'], facts['foreign_inode'])
            self.assertEqual(facts['selector'], 'NEW exact bytes\n')

    def test_recovery_parent_directory_fsync_precedes_commit(self):
        root = Root(self.base)
        self.addCleanup(root.close)
        selector = 'outputs/approved-selector.json'
        root.write(selector, b'OLD')
        original_fsync, original_replace = os.fsync, os.replace
        events = []
        def fsync(fd):
            events.append(('fsync', os.readlink(f'/proc/self/fd/{fd}')))
            return original_fsync(fd)
        def replace(src, dst, **kw):
            if str(src).startswith('.selector-'):
                self.assertTrue(any(k == 'fsync' and Path(p) == self.base/'outputs' for k, p in events))
                recovery = next((self.base/'outputs').glob('.rollback-*.json'))
                self.assertEqual(recovery.read_bytes(), b'OLD')
                self.assertTrue(any(k == 'fsync' and Path(p) == recovery for k, p in events))
                events.append(('commit', str(src)))
            return original_replace(src, dst, **kw)
        with root.lock(), patch.object(review.os, 'fsync', fsync), patch.object(review.os, 'replace', replace):
            review.select_exact(root, selector, b'NEW', lambda: None)
        self.assertTrue(any(k == 'commit' for k, _ in events))

    def test_cancel_during_terminal_settlement_keeps_lock_and_settles_entire_group(self):
        path = self.base/'consumer'
        copy_fixture(path, 16)
        process = subprocess.Popen([sys.executable, '-W', 'error::ResourceWarning', '-c', LOCK_WORKER, str(path)],
                                   env=ENV, cwd='/tmp', stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        observations=[];deadline=time.monotonic()+45
        try:
            while True:
                try:
                    out,err=process.communicate(timeout=.1)
                    break
                except subprocess.TimeoutExpired:
                    self.assertLess(time.monotonic(),deadline)
                    if (path/'descendant.ready').exists():
                        pid=int((path/'descendant.pid').read_text())
                        stat=Path(f'/proc/{pid}/stat')
                        try:before=stat.read_text().rsplit(')',1)[1].split()
                        except FileNotFoundError:continue
                        fd=os.open(path/'.tileset-lab.lock',os.O_RDWR)
                        try:
                            inode=os.fstat(fd).st_ino
                            try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);blocked=False
                            except BlockingIOError:blocked=True
                        finally:os.close(fd)
                        try:after=stat.read_text().rsplit(')',1)[1].split()
                        except FileNotFoundError:continue
                        if before[19]==after[19] and before[0]!='Z' and after[0]!='Z':
                            observations.append({'pid':pid,'pgid':int(after[2]),'starttime':after[19],'lock_inode':inode,'blocked':blocked})
                            self.assertTrue(blocked,'Independent observer saw unlocked root while descendant remained alive')
        finally:
            if process.poll() is None:
                os.kill(process.pid,signal.SIGTERM)
                process.communicate(timeout=10)
        self.assertTrue(observations,'Independent outside-group observer must witness live-descendant lock contention')
        self.assertTrue(all(r['pgid']==process.pid for r in observations))
        self.assertEqual(process.returncode, 130, err)
        report = parse_json(out, 'cancelled real CLI')
        check_report(report)
        self.assertEqual(report['status'], 'CANCELLED')
        events = [json.loads(row) for row in (path/'lock-events.jsonl').read_text().splitlines()]
        self.assertTrue(events)
        self.assertTrue(all(e['lock'] == 'BLOCKED_BY_TRANSACTION' for e in events), events)
        self.assertFalse(Path('/proc/'+(path/'descendant.pid').read_text()).exists())
        self.assertEqual(group_members(report['process']['pgid']), [])
        root = Root(path)
        try:
            with root.lock():pass
        finally:root.close()

    def test_nonobject_candidate_reports_emit_bounded_blocked_json(self):
        path = self.base/'consumer'
        copy_fixture(path, 16)
        for index, value in enumerate((None, [], 'scalar', 123, True)):
            candidate = f'malformed-{index}'
            directory = path/'outputs/candidates'/candidate
            directory.mkdir(parents=True)
            (directory/'report.json').write_bytes(json_bytes(value))
            run = subprocess.run([sys.executable, '-W', 'error::ResourceWarning', '-m', 'tileset_lab', 'render',
                                  '--project-root', str(path), '--manifest', 'manifest.json', '--candidate-id', candidate],
                                 env=ENV, cwd='/tmp', capture_output=True, timeout=30)
            self.assertEqual(run.returncode, 2, run.stderr)
            report = parse_json(run.stdout, 'malformed candidate CLI failure')
            check_report(report)
            self.assertEqual(report['status'], 'BLOCKED')
            self.assertIn('JSON object', report['error'])
            self.assertNotIn(b'Traceback', run.stderr)


class CoverageAndReceiptRepairs(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='phase02-proof-boundary-')
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)

    def test_coverage_channels_canonical_for_draw_and_context_after_sorted_json_roundtrip(self):
        from PIL import Image
        from tileset_lab.sources import png_bytes
        root = Root(self.path)
        self.addCleanup(root.close)
        root.write('test.png', png_bytes(Image.new('RGBA', (16,16), 'blue')))
        root.write('test.tmx', b'<map/>')
        root.write('native/expected-inventory.json', b'{}')
        commands = {}
        for name in ('draw','render','animation'):
            logs = {}
            for channel in ('stdout','stderr'):
                path = name+'-'+channel+'.log'
                root.write(path, b'TEST-ONLY channel ordering control')
                logs[channel] = review.file_record(root, path)
            commands[name] = {'logs':logs}
        commands['animation'] = [{'command':commands['animation']}]
        state = {'native_directory':'native','candidate':'unit','source_author':'TEST-ONLY:author',
                 'identity':{'dependencies':{},'sha256':'a'*64},'approval':{'sha256':'b'*64},
                 'registrations':{},'terrains':{},'parts':{}}
        item = {'id':'TEST-ONLY-draw','kind':'draw-stage','pack':'pack','family':'family','mode':'opaque','case':'case','stage':'stage',
                'context':None,'elapsed_ms':0,'intent':'TEST-ONLY ordering, NOT native acceptance',
                'field_sha256':'c'*64,'recipe_sha256':'d'*64,'png':'test.png','expected':'test.png','tmx':'test.tmx','crops':[],'pages':[]}
        context = {**item,'id':'TEST-ONLY-context','kind':'scene','map':'test.tmx'}
        def coverage(commands):
            with patch.object(validate, '_declaration', return_value={'items':[item,context]}), patch.object(validate, '_source_views', return_value=[]):
                return validate._coverage(Inputs(root), {'id':'unit'}, state, {'commands':commands}, {'sha256':'e'*64}, create=False)
        before = coverage(commands)
        after = coverage(parse_json(json_bytes(commands), 'sorted command reload'))
        self.assertEqual(before, after)
        self.assertEqual(parse_json(json_bytes(before), 'FULL binding reload'), after)
        for binding in after['bindings']:
            self.assertEqual([r['path'].split('-')[-1] for r in binding['logs']], ['stdout.log','stderr.log']*(2 if binding['kind']=='draw-stage' else 3))

    def test_nested_candidate_malformed_containers_and_booleans_fail_bounded_cli(self):
        path=self.path/'consumer';copy_fixture(path,16)
        packet=inspect(path,id='test-only-schema',initialize=True);trust_record(path,packet)
        build(path,id='test-only-schema',test=True)
        report_path=path/'outputs/candidates/test-only-schema/report.json'
        original=parse_json(report_path.read_bytes(),'valid TEST-ONLY candidate')
        mutations=[]
        for key,value in (('output_inventory',[]),('provenance',None),('input_hashes',[]),('counts',[]),('schema_version',True)):
            wrong=deepcopy(original);wrong[key]=value;mutations.append(wrong)
        for key in ('test_only','actual_visual_approval'):
            wrong=deepcopy(original);wrong['source_approval'][key]=int(wrong['source_approval'][key]);mutations.append(wrong)
        wrong=deepcopy(original);wrong['counts']['families']=True;mutations.append(wrong)
        for wrong in mutations:
            report_path.write_bytes(json_bytes(wrong))
            run=subprocess.run([sys.executable,'-W','error::ResourceWarning','-m','tileset_lab','render','--project-root',str(path),
                                '--manifest','manifest.json','--candidate-id','test-only-schema','--test-trust'],
                               env=ENV,cwd='/tmp',capture_output=True,timeout=30)
            self.assertEqual(run.returncode,2,run.stderr)
            public=parse_json(run.stdout,'nested malformed candidate CLI');check_report(public)
            self.assertEqual(public['status'],'BLOCKED')
            self.assertNotIn(b'Traceback',run.stderr)
        for value in ({'cells':False,'objects':0},{'cells':0,'objects':False}):
            with self.assertRaises(Blocked):validate._stats(value)
        for value in ({'native_masks':True},[],None):
            with self.assertRaises(Blocked):validate._counts(value,'TEST-ONLY saved computation')

    def test_malformed_failed_owner_has_bounded_cli_failure_and_no_stage_claim(self):
        # Same-inode corruption of a NEW owned stage, not source/fixture writes
        # or production approval. Keep the real parser and CLI failure guards.
        worker = r'''
import json,sys
from pathlib import Path
from tileset_lab import __main__
from tileset_lab.manifest import Root,Blocked
folder=Path(sys.argv[1]);bad=json.loads(sys.argv[2]);original=Root.write
fired=False
def write(self,rel,data,**kw):
 global fired
 result=original(self,rel,data,**kw)
 if rel=='outputs/inspections/malformed-owner/owner.json' and not fired:
  fired=True;path=self.path/rel;inode=path.stat().st_ino
  path.write_bytes(json.dumps(bad).encode());assert path.stat().st_ino==inode
  (folder/'intended-owner-fault-hit.json').write_text(json.dumps({'fired':True,'inode':inode,'same_inode':True}))
  raise Blocked('TEST-ONLY intended owned-owner corruption before staging failure')
 return result
Root.write=write
raise SystemExit(__main__.main(['inspect','--project-root',str(folder),'--manifest','manifest.json','--inspection-id','malformed-owner','--initialize-inventory']))
'''
        for bad in ([],None,7):
            temp=tempfile.TemporaryDirectory(prefix='tileset-lab-malformed-owner-');self.addCleanup(temp.cleanup)
            path=Path(temp.name)/'consumer';copy_fixture(path,16)
            old={p.relative_to(path).as_posix():sha256(p.read_bytes()) for p in path.rglob('*') if p.is_file()}
            run=subprocess.run([sys.executable,'-W','error::ResourceWarning','-c',worker,str(path),json.dumps(bad)],env=ENV,cwd='/tmp',capture_output=True,timeout=45)
            self.assertEqual(run.returncode,2,(bad,run.stdout,run.stderr))
            report=parse_json(run.stdout,'malformed owned staging JSON');check_report(report)
            self.assertEqual(report['status'],'BLOCKED')
            self.assertTrue((path/'intended-owner-fault-hit.json').exists())
            record=next(row for row in report['artifacts'] if row['kind']=='full-report')
            full=parse_json((path/record['path']).read_bytes(),'actual full failure report')
            self.assertIn('ownership_warning',full)
            self.assertNotIn('outputs/inspections/malformed-owner',full['owned_paths'])
            self.assertNotIn(b'Traceback',run.stderr)
            self.assertTrue(all(sha256((path/p).read_bytes())==h for p,h in old.items()))

    def test_nonobject_saved_computational_json_rejected_before_dictionary_access(self):
        root = Root(self.path)
        self.addCleanup(root.close)
        for i, value in enumerate((None, [], 'scalar', 42, True)):
            path = f'native/computational-{i}.json'
            root.write(path, json_bytes(value))
            with self.assertRaisesRegex(Blocked, 'JSON object'):validate._json(root, path)

    def test_final_receipt_rechecks_actual_complete_payload_seal_and_runtime_after_review(self):
        # TEST-ONLY late freshness predicate. These synthetic trust flags NEVER
        # produce a receipt; no production source/native authorizations exercised.
        from tileset_lab.native import runtime_content
        from tileset_lab.sources import tool_identity
        for target in ('payload','extra-output','seal','runtime'):
            path = self.path/target
            copy_fixture(path, 16)
            if target == 'runtime':
                doc = parse_json((path/'manifest.json').read_bytes(), 'TEST-ONLY runtime-copy manifest')
                installed = Path(doc['tiled_runtime']).parent
                disposable = path/'owned-disposable-runtime'
                shutil.copytree(installed, disposable, symlinks=True)
                assert not (disposable/'AppRun').is_symlink()
                doc['tiled_runtime'] = str(disposable/'AppRun')
                (path/'manifest.json').write_bytes(json_bytes(doc))
            inspect(path, id='test-only-freshness', initialize=True)
            root = Root(path)
            try:
                inputs = Inputs(root);manifest = load_manifest(inputs, 'manifest.json')
                directory = 'outputs/candidates/unit'
                root.write(directory+'/payload.bin', b'TEST-ONLY retained payload')
                root.write(directory+'/coverage.json', b'{}')
                root.write(directory+'/computational.json', b'{}')
                runtime = runtime_content(manifest['tiled_runtime'])
                root.write(directory+'/runtime.json', json_bytes(runtime))
                seal_record, seal = review.freeze(inputs, manifest, 'unit', directory, directory+'/coverage.json', directory+'/computational.json',
                                                directory+'/runtime.json', {'test_only':False,'TEST_ONLY':'no actual source approval'}, 'TEST-ONLY')
                root.write('reviews/TEST-only-native.json', b'TEST-ONLY no actual image review')
                approval = {'test_only':False,'path':'reviews/TEST-only-native.json','sha256':review.file_record(root,'reviews/TEST-only-native.json')['sha256']}
                if target == 'payload':(path/directory/'payload.bin').write_bytes(b'TEST-ONLY honestly altered late payload')
                if target == 'extra-output':root.write(directory+'/extra.bin', b'TEST-ONLY late foreign membership')
                if target == 'seal':
                    changed = deepcopy(seal);changed['producer'] = 'TEST-ONLY late replacement'
                    (path/seal_record['path']).write_bytes(json_bytes(changed))
                if target == 'runtime':
                    launcher = Path(manifest['tiled_runtime'])
                    launcher.write_bytes(launcher.read_bytes()+b'\n# TEST-ONLY owned late runtime content change\n')
                    self.assertNotEqual(runtime_content(manifest['tiled_runtime'])['sha256'], runtime['sha256'])
                with root.lock():
                    with self.assertRaises(Blocked):review.write_receipt(inputs, manifest, 'unit', 'must-not-exist', seal_record, seal, approval, {})
                self.assertFalse(root.exists('outputs/receipts/must-not-exist.json'))
            finally:root.close()


class IntentCoverageRepairs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.cases = drawcases.declare_cases()

    def test_all_sixteen_boundary_variants_enter_named_side_with_explicit_axes(self):
        for case in self.cases:
            if case['group'] != '08':continue
            side, axis = case['variant'].split('-')
            points = [s['raw_requests'][0][:2] for s in case['stages'] if 'enter-cross-' in s['id']]
            self.assertEqual(len(points), 7)
            # Named side, not accidental East/South. Tangent approaches are
            # explicit Manhattan paths, never a purported diagonal/GUI drag.
            target = side if len(side) == 1 else next(d for d in side if d in ('ew' if axis == 'h' else 'ns'))
            coordinate, outside, boundary = (1, -1, 0) if target == 'n' else (1, 1, 12) if target == 's' else (0, -1, 0) if target == 'w' else (0, 1, 12)
            self.assertTrue((points[0][coordinate]-boundary)*outside > 0, case['id'])
            self.assertTrue(any(p[coordinate] == boundary for p in points), case['id'])
            self.assertTrue((points[-1][coordinate]-boundary)*outside < 0, case['id'])
            self.assertTrue(all(abs(a[0]-b[0])+abs(a[1]-b[1]) == 1 for a, b in zip(points, points[1:])))

    def test_junction_tip_crops_cover_full_width_and_current_or_withdrawn_tip_support(self):
        for case in self.cases:
            if case['group'] != '04':continue
            width = case['width_vertices']
            for stage in case['stages']:
                relevant = {(x, y) for y, row in enumerate(stage['expected_field']) for x, v in enumerate(row) if v}
                relevant.update((x, y) for x, y, _ in stage['accepted_requests'])
                for direction in case['orientations']:
                    dx, dy = drawcases.DIRECTIONS[direction]
                    distances = range(1, 5-width)
                    tips = [[(6+dx*d+x, 6+dy*d+y) for y in range(width) for x in range(width)] for d in distances]
                    def face(points):
                        extreme=max(x*dx+y*dy for x,y in points)
                        return {(x,y) for x,y in points if x*dx+y*dy==extreme}
                    points = next((p for p in reversed(tips) if relevant.intersection(face(p))), tips[-1])
                    crop = next(c for c in stage['crops'] if c['id'] == 'arm-tip-'+direction)['cell_rect']
                    left, top, w, h = crop
                    for x, y in points:
                        for cx, cy in ((x-1,y-1),(x,y-1),(x-1,y),(x,y)):
                            self.assertTrue(left <= cx < left+w and top <= cy < top+h, (case['id'],stage['id'],direction,crop,(cx,cy)))
                    self.assertLess(w*h, 144, 'Focused tip crop cannot be replaced by a full image')
                    if f'add-{direction}-' in stage['id']:
                        for x,y,_ in stage['raw_requests']:
                            for cx,cy in ((x-1,y-1),(x,y-1),(x-1,y),(x,y)):
                                self.assertTrue(left<=cx<left+w and top<=cy<top+h, (case['id'],stage['id'],crop,(cx,cy)))

    def test_distinct_semantic_topology_rejects_honest_bridge_and_nested_gap_fields(self):
        total = 0
        for case in self.cases:
            for stage in case['stages']:
                verdict = drawcases.topology(case, stage, stage['expected_field'])
                total += verdict is not None
                if case['group'] == '06' and any(name in stage['id'] for name in ('hollow-row-4','cut-outer-boundary','refill-outer-boundary')):
                    field=deepcopy(case['stages'][case['stages'].index(stage)-1]['expected_field'])
                    with self.assertRaisesRegex(Blocked, 'Nested topology'):drawcases.topology(case, stage, field)
                if case['group'] == '06' and 'inner-island' in stage['id']:
                    field = deepcopy(stage['expected_field'])
                    x = 7 if case['variant'] == 'mirrored' else 5
                    field[6][4 if x == 5 else 8] = 1  # Honest binary field bridges moat.
                    with self.assertRaisesRegex(Blocked, 'Nested topology'):drawcases.topology(case, stage, field)
                if case['group'] == '09' and 'cut-bridge' in stage['id']:
                    field = deepcopy(stage['expected_field'])
                    for y in range(6, 6+case['width_vertices']):
                        x, yy = (6, y) if case['orientations'] == ['h'] else (y, 6)
                        field[yy][x] = 1
                    with self.assertRaisesRegex(Blocked, 'Bridge topology'):drawcases.topology(case, stage, field)
                if case['group'] == '09' and 'join-7' in stage['id']:
                    hole = deepcopy(stage['expected_field'])
                    for column in range(5,8):
                        x,y=(column,4) if case['orientations']==['h'] else (4,column)
                        hole[y][x]=1
                    with self.assertRaisesRegex(Blocked, 'background hole'):drawcases.topology(case, stage, hole)
                    field = deepcopy(stage['expected_field'])
                    for y in range(6, 6+case['width_vertices']):
                        x, yy = (6, y) if case['orientations'] == ['h'] else (y, 6)
                        field[yy][x] = 0
                    with self.assertRaisesRegex(Blocked, 'Bridge topology'):drawcases.topology(case, stage, field)
        self.assertEqual(total, 118)

    def test_inverse_shape_label_describes_empty_field(self):
        stages = [s for c in self.cases if c['group'] == '10' for s in c['stages'] if 'clear-repainted-shape' in s['id']]
        self.assertEqual(len(stages), 4)
        self.assertTrue(all(not any(any(row) for row in s['expected_field']) for s in stages))


if __name__ == '__main__':unittest.main()
