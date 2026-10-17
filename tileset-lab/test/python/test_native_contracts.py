"""Phase02 boundary tests. Synthetic review PASS records are TEST-ONLY.

No test creates actual source/native visual approval. Real exit-zero error and
process ownership controls use the existing authorized native runtime. The whole
matrix's terminal attempt/evidence is separate, not substituted by these tests.
"""
from __future__ import annotations

from copy import deepcopy
from itertools import product
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

import numpy as np
from PIL import Image

from test_core import copy_fixture, inspect, trust_record, build, read_json, set_json
from tileset_lab import drawcases, expectation
from tileset_lab.manifest import Blocked, Inputs, Root, json_bytes, load_manifest, parse_json, sha256
from tileset_lab.native import (ERROR, _environment, run_owned, require_native_sentinel,
                                runtime_content)
from tileset_lab.report import bounded_report, check_report
from tileset_lab.review import (check_review, file_record, select_exact, write_receipt,
                                _check_binding)
from tileset_lab.sources import tool_identity, image_bytes, png_bytes
from tileset_lab.validate import _candidate, _declaration, _draw_readback, _compute

EVIDENCE = Path('/tmp/tileset-lab-evidence/phase-02')
CONSUMERS = EVIDENCE/'consumers/unit-controls'
CONSUMERS.mkdir(parents=True, exist_ok=True)
PACKAGE = Path(__file__).resolve().parents[2]
APP = Path('/home/dhickel/.cache/rpgw-tiled/1.12.2/squashfs-root/AppRun')


class GestureIntentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases = drawcases.declare_cases()

    def test_complete_unsplit_expansions_and_initial_every_stage(self):
        self.assertEqual(len(self.cases), 92)
        self.assertEqual(sum(len(c['stages']) for c in self.cases), 1428)
        self.assertEqual({c['group'] for c in self.cases}, {f'{g:02d}' for g in range(1,12)})
        groups = {g: [c for c in self.cases if c['group'] == g] for g in {c['group'] for c in self.cases}}
        self.assertEqual({c['variant'] for c in groups['01']}, {'n','e','s','w'})
        self.assertEqual({c['variant'] for c in groups['03']}, {f'{a}-w{w}' for a,w in product(('h','v'),(1,2))})
        self.assertEqual(len(groups['04']), 18)
        self.assertEqual({c['variant'] for c in groups['05']}, {'n','e','s','w'})
        self.assertEqual({c['variant'] for c in groups['07']}, {'mask5','mask10','chain-down','chain-up','checker-parity-0','checker-parity-1'})
        self.assertEqual({c['variant'] for c in groups['08']}, {f'{b}-{a}' for b,a in product(('n','e','s','w','nw','ne','se','sw'),('h','v'))})
        self.assertEqual(len(groups['11']), 26)
        for case in self.cases:
            self.assertEqual(case['stages'][0]['id'], 's000-seed')
            self.assertEqual(case['stages'][0]['raw_requests'], [])
            self.assertEqual(case['initial_field'], [[0]*13 for _ in range(13)])
            self.assertEqual(len({s['id'] for s in case['stages']}), len(case['stages']))
            current = case['initial_field']
            for stage in case['stages']:
                after, accepted, prior = drawcases.interpret(current, stage['raw_requests'])
                self.assertEqual(after, stage['expected_field'])
                self.assertEqual(accepted, stage['accepted_requests'])
                self.assertEqual(prior, stage['captured_prior'])
                self.assertEqual(sha256(json_bytes(after)), stage['field_sha256'])
                self.assertEqual(drawcases.masks(after), expectation.intent_masks(after))
                self.assertGreaterEqual(len(stage['crops']), 2)
                self.assertEqual(len(stage['pages']), 2)
                current = after

    def test_prior_inverse_restores_one_not_always_zero(self):
        found = False
        for case in self.cases:
            for stage in case['stages']:
                if 'withdraw' in stage['id'] or 'inverse' in stage['id']:
                    found |= any(request[2] == 1 for request in stage['raw_requests'])
        self.assertTrue(found, 'Overlapping A must be captured/restored by an inverse stroke')
        field = [[0]*13 for _ in range(13)]
        field[6][6] = 1
        result, accepted, prior = drawcases.interpret(field, [[6,6,0],[6,6,1],[7,6,1]])
        self.assertEqual(prior, [[6,6,1],[7,6,0]])
        restored, _, _ = drawcases.interpret(result, [[x,y,v] for x,y,v in prior])
        self.assertEqual(restored, field)

    def test_all_central_requests_legal_width_units_and_boundary_noop(self):
        for case in self.cases:
            if case['group'] not in ('08','10'):
                for stage in case['stages']:
                    if 'clear' in stage['id']:
                        continue
                    for x,y,_ in stage['raw_requests']:
                        self.assertTrue(2 <= x <= 9 and 2 <= y <= 9, (case['id'],stage['id'],x,y))
            if case['width_vertices'] is not None:
                self.assertIn(case['width_vertices'], (1,2))
            if case['group'] == '08':
                outside = next(s for s in case['stages'] if 'wholly-outside' in s['id'])
                before = case['stages'][case['stages'].index(outside)-1]['expected_field']
                self.assertEqual(outside['accepted_requests'], [])
                self.assertEqual(outside['expected_field'], before)
        one = next(c for c in self.cases if c['id']=='03-h-w1')
        two = next(c for c in self.cases if c['id']=='03-h-w2')
        a = next(s['expected_field'] for s in one['stages'] if 'widen-to-two' in s['id'])
        b = next(s['expected_field'] for s in two['stages'] if 'equivalent-direct' in s['id'])
        self.assertEqual(a,b)
        self.assertEqual(sum(any(v for v in row) for row in a),2)

    def test_equivalent_field_groups_only_compare_identical_final_fields(self):
        by_group = {}
        for case in self.cases:
            for stage in case['stages']:
                key = stage['equivalence']
                if key:
                    by_group.setdefault(key,[]).append(stage['expected_field'])
        self.assertGreater(len(by_group),6)
        for fields in by_group.values():
            self.assertTrue(all(field==fields[0] for field in fields))
        self.assertEqual(len(by_group['full-tile-four-corners']),2)
        self.assertEqual(sum(sum(row) for row in by_group['full-tile-four-corners'][0]),4)

    def test_complete_expected_inventory_precedes_native_and_unique_ids(self):
        for size in (16,32):
            declared = drawcases.inventory(f'consumer-{size}', [{'pack':'pack','family':'opaque','mode':'opaque'},
                                                               {'pack':'pack','family':'alpha','mode':'alpha'}], size)
            self.assertEqual(len(declared['items']),2856)
            self.assertEqual(len({i['id'] for i in declared['items']}),2856)
            self.assertEqual(declared['width_unit'],'vertex rows/columns')
            self.assertTrue(all(len(i['field_sha256'])==len(i['recipe_sha256'])==64 for i in declared['items']))
        for request in ([[True,0,1]], [[0,0,True]], [[0.0,0,1]], [[0,0,2]], [[0,0]], [[0,0,float('nan')]]):
            with self.assertRaises(Blocked):
                drawcases.interpret([[0]*13 for _ in range(13)],request)

    def test_masks_and_full_512_neighborhoods_independent_bit_weights(self):
        for bits in range(512):
            field = [[0]*13 for _ in range(13)]
            for i in range(9):
                field[5+i//3][5+i%3] = (bits>>i)&1
            self.assertEqual(drawcases.masks(field),expectation.intent_masks(field))
        for bit in range(4):
            field = [[0]*13 for _ in range(13)]
            x,y = ((6,6),(7,6),(7,7),(6,7))[bit]
            field[y][x] = 1
            self.assertEqual(drawcases.masks(field)[6][6],1<<bit)


class ReviewPublicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='review-',dir=CONSUMERS)
        self.path = Path(self.temp.name)
        self.root = Root(self.path)
        self.image = Image.new('RGBA',(16,16),(83,122,44,255))
        self.root.write('evidence/native.png',png_bytes(self.image))
        self.root.write('evidence/expected.png',png_bytes(self.image))
        self.root.write('evidence/crop.png',png_bytes(self.image))
        self.root.write('evidence/page.png',png_bytes(self.image))
        self.root.write('evidence/native.tmx',b'<map/>\n')
        self.root.write('evidence/terrain.tsx',b'<tileset/>\n')
        self.root.write('evidence/log.stdout.log',b'TEST-ONLY schema fixture, not actual native execution\n')
        self.manifest = {'id':'unit-consumer','output_root':'outputs'}
        self.seal_record = file_record(self.root,'evidence/native.tmx')
        self.bindings = []
        for number in (0,1):
            digest = sha256(json_bytes({'TEST-ONLY':number}))
            png = file_record(self.root,'evidence/native.png')
            crop = {'id':'stroke-local','pixel_rect':[0,0,16,16], 'actual':'evidence/crop.png','expected':'evidence/expected.png',
                    'actual_file':file_record(self.root,'evidence/crop.png'),'expected_file':file_record(self.root,'evidence/expected.png')}
            page = {'id':'checker-intent-expected-native','path':'evidence/page.png','file':file_record(self.root,'evidence/page.png'),
                    'dimensions':[16,16],'integer_nearest_zoom':1}
            self.bindings.append({'id':f'pack/family/01-n/s00{number}-test','consumer':'unit-consumer','kind':'draw-stage',
                'pack':'pack','family':'family','mode':'opaque','case':'01-n','stage':f's00{number}-test', 'context':None,'elapsed_ms':0,
                'intent':'TEST-ONLY closed-schema fixture. No image viewing or actual native proof.',
                **{key:digest for key in ('field_sha256','recipe_sha256','expected_inventory_sha256','source_approval_sha256','tool_sha256','dependency_sha256','runtime_sha256')},
                'tsx':[file_record(self.root,'evidence/terrain.tsx')], 'atlases_original_rectangles':[png],
                'native_tmx':self.seal_record,'logs':[file_record(self.root,'evidence/log.stdout.log')], 'native_png':png,
                'crops':[crop], 'pages':[page], 'required_views':[file_record(self.root,p) for p in ('evidence/native.png','evidence/expected.png','evidence/crop.png','evidence/page.png')]})
        coverage = {'schema_version':1,'consumer':'unit-consumer','candidate':'candidate','expected_inventory':self.seal_record,
                    'independent_of':['TEST-ONLY:author','tileset-lab/native-producer'],'bindings':self.bindings}
        self.root.write('evidence/coverage.json',json_bytes(coverage))
        self.seal = {'directory':'outputs/candidates/candidate','coverage':file_record(self.root,'evidence/coverage.json'),
                     'source_approval':{'test_only':True}}
        self.review = {'schema_version':1,'status':'REVIEWED','consumer':'unit-consumer','candidate':'candidate',
                       'seal':self.seal_record,'coverage':self.seal['coverage'],
                       'reviewer':{'id':'TEST-ONLY:review-parser','kind':'TEST-ONLY','image_capable':True,'independent_of':coverage['independent_of']},
                       'verdict':'PASS','entries':[{'binding':b,'verdict':'PASS',
                       'observations':'TEST-ONLY parser coverage and metadata validation; NOT actual image viewing or artistic approval.',
                       'viewed':[{'path':r['path'],'sha256':r['sha256'],'observations':'TEST-ONLY synthetic viewed-record parser fixture, NOT actual viewing.'} for r in b['required_views']]} for b in self.bindings]}

    def tearDown(self):
        self.root.close()
        self.temp.cleanup()

    def check(self, review, trust=True):
        path = f'outputs/reviews/test-{time.time_ns()}.json'
        self.root.write(path,json_bytes(review))
        return check_review(self.root,self.manifest,'candidate',self.seal_record,self.seal,path,allow_test_trust=trust)

    def test_closed_test_only_review_accepted_only_explicitly_never_actual(self):
        result = self.check(self.review)
        self.assertTrue(result['test_only'])
        self.assertFalse(result['actual_visual_approval'])
        self.assertEqual(result['entries'],2)
        with self.assertRaisesRegex(Blocked,'TEST-ONLY'):
            self.check(self.review,trust=False)
        with self.assertRaisesRegex(Blocked,'TEST-ONLY'):
            write_receipt(Inputs(self.root),self.manifest,'candidate','receipt',self.seal_record,self.seal,result,{})
        self.assertFalse(self.root.exists('outputs/receipts/receipt.json'))

    def test_full_expected_coverage_not_reviewer_totals(self):
        mutations = []
        wrong=deepcopy(self.review);wrong['entries'].pop();mutations.append(wrong)
        wrong=deepcopy(self.review);wrong['entries'].append(wrong['entries'][0]);mutations.append(wrong)
        wrong=deepcopy(self.review);wrong['entries'][0]['binding']['id']='unknown';mutations.append(wrong)
        wrong=deepcopy(self.review);wrong['totals']=2;mutations.append(wrong)
        wrong=deepcopy(self.review);wrong['entries'][0]['viewed'].pop();mutations.append(wrong)
        wrong=deepcopy(self.review);wrong['entries'][0]['viewed'].append(wrong['entries'][0]['viewed'][0]);mutations.append(wrong)
        wrong=deepcopy(self.review);wrong['entries'][0]['binding']['elapsed_ms']=False;mutations.append(wrong)
        wrong=deepcopy(self.review);wrong['entries'][0]['binding']['crops'][0]['pixel_rect'][0]=False;mutations.append(wrong)
        wrong=deepcopy(self.review);wrong['entries'][0]['binding']['pages'][0]['integer_nearest_zoom']=True;mutations.append(wrong)
        for wrong in mutations:
            with self.assertRaises(Blocked):
                self.check(wrong)

    def test_missing_stale_negative_duplicate_partial_self_review_blocks(self):
        mutations=[]
        for key,value in [('status','UNAPPROVED'),('verdict','BLOCKED'),('consumer','other')]:
            wrong=deepcopy(self.review);wrong[key]=value;mutations.append(wrong)
        wrong=deepcopy(self.review);wrong['entries'][0]['verdict']='BLOCKED';mutations.append(wrong)
        wrong=deepcopy(self.review);wrong['entries'][0]['observations']='PASS';mutations.append(wrong)
        wrong=deepcopy(self.review);wrong['reviewer']['image_capable']=False;mutations.append(wrong)
        wrong=deepcopy(self.review);wrong['reviewer']['id']='tileset-lab/native-producer';mutations.append(wrong)
        wrong=deepcopy(self.review);wrong['seal']['sha256']='0'*64;mutations.append(wrong)
        wrong=deepcopy(self.review);wrong['entries'][0]['binding']['recipe_sha256']='0'*64;mutations.append(wrong)
        wrong=deepcopy(self.review);wrong['entries'][0]['viewed'][0]['sha256']='0'*64;mutations.append(wrong)
        for wrong in mutations:
            with self.assertRaises(Blocked):self.check(wrong)
        with self.assertRaises((Blocked,OSError)):
            check_review(self.root,self.manifest,'candidate',self.seal_record,self.seal,'outputs/reviews/missing.json')

    def test_native_binding_closed_geometry_page_limits_hashes(self):
        valid = deepcopy(self.bindings[0])
        _check_binding(self.root,valid)
        mutations=[]
        for key,value in [('extra',1),('elapsed_ms',True),('mode','unknown'),('context','not-null'),('field_sha256','bad')]:
            wrong=deepcopy(valid);wrong[key]=value;mutations.append(wrong)
        wrong=deepcopy(valid);wrong['crops'][0]['pixel_rect']=[True,0,16,16];mutations.append(wrong)
        wrong=deepcopy(valid);wrong['pages'][0]['dimensions']=[2001,16];mutations.append(wrong)
        wrong=deepcopy(valid);wrong['pages'][0]['integer_nearest_zoom']=1.5;mutations.append(wrong)
        wrong=deepcopy(valid);wrong['native_tmx']['sha256']='0'*64;mutations.append(wrong)
        for wrong in mutations:
            with self.assertRaises(Blocked):_check_binding(self.root,wrong)

    def test_single_selector_atomic_selection_and_before_after_write_failures(self):
        selector='outputs/approved-selector.json'
        self.root.write(selector,b'OLD selector exact bytes\n')
        self.root.write('outputs/previous-approved/art.bin',b'OLD approved immutable art\0\xff')
        original=(self.root.read(selector)[0],self.root.read('outputs/previous-approved/art.bin')[0])
        for fail_at in (1,2):
            calls=[]
            def check():
                calls.append(1)
                if len(calls)==fail_at:raise OSError('TEST-ONLY simulated validation/write failure')
            with self.root.lock():
                with self.assertRaises(OSError):select_exact(self.root,selector,b'NEW desired selector\n',check)
            self.assertEqual(self.root.read(selector)[0],original[0])
            self.assertEqual(self.root.read('outputs/previous-approved/art.bin')[0],original[1])
        with self.root.lock():select_exact(self.root,selector,b'NEW desired selector\n',lambda:None)
        self.assertEqual(self.root.read(selector)[0],b'NEW desired selector\n')
        self.assertEqual(self.root.read('outputs/previous-approved/art.bin')[0],original[1])
        self.assertFalse(any('/.selector-' in p for p in self.root.files('outputs')))

    def test_finalizer_failure_cancellation_and_prepared_recovery_do_not_select(self):
        selector='outputs/approved-selector.json'
        self.root.write(selector,b'OLD exact selector\n')
        self.root.write('outputs/previous-approved/art.bin',b'OLD art\0\xff')
        for error in (OSError('TEST-ONLY final report write failed'),KeyboardInterrupt('TEST-ONLY finalizer cancelled')):
            def fail():
                self.assertEqual(self.root.read(selector)[0],b'TEST-ONLY new selection\n')
                raise error
            with self.root.lock():
                with self.assertRaises(type(error)):
                    select_exact(self.root,selector,b'TEST-ONLY new selection\n',lambda:None,fail)
            self.assertEqual(self.root.read(selector)[0],b'OLD exact selector\n')
            self.assertEqual(self.root.read('outputs/previous-approved/art.bin')[0],b'OLD art\0\xff')

    def test_concurrent_review_replacement_never_hashes_unvalidated_bytes(self):
        from unittest.mock import patch
        path='outputs/reviews/replaced.json'
        self.root.write(path,json_bytes(self.review))
        read=self.root.read
        calls=[]
        def replacing(value):
            if value==path:
                calls.append(1)
                if len(calls)==2:
                    blocked=deepcopy(self.review);blocked['verdict']='BLOCKED'
                    (self.path/path).write_bytes(json_bytes(blocked))
            return read(value)
        with patch.object(self.root,'read',side_effect=replacing):
            with self.assertRaisesRegex(Blocked,'changed/replaced'):
                check_review(self.root,self.manifest,'candidate',self.seal_record,self.seal,path,allow_test_trust=True)

    def test_selector_symlink_and_foreign_change_no_unsafe_cleanup(self):
        self.root.mkdir('outputs')
        (self.path/'outputs/approved-selector.json').symlink_to(self.path/'evidence/native.png')
        with self.assertRaises(Blocked):select_exact(self.root,'outputs/approved-selector.json',b'bad',lambda:None)
        self.assertEqual(self.root.read('evidence/native.png')[0],png_bytes(self.image))

    def test_parse_nonfinite_duplicate_partial_json_does_not_bypass_review(self):
        for value in (b'{"x":NaN}',b'{"x":1e999}',b'{"x":1,"x":2}',b'{"x":'):
            with self.assertRaises(Blocked):parse_json(value,'TEST-ONLY review negative')


class NativeOwnershipTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='ownership-',dir=CONSUMERS)
        self.path=Path(self.temp.name)
        self.root=Root(self.path)

    def tearDown(self):
        self.root.close();self.temp.cleanup()

    def test_exact_unique_terminal_sentinel_all_errors_before_after(self):
        sentinel='TILESET_LAB_NATIVE_PASS unit-token native_draw.js'
        require_native_sentinel('Evaluating\n'+sentinel+'\n','',sentinel)
        for stdout,stderr in [('', ''),(sentinel+'\n'+sentinel+'\n',''),(sentinel+'\nlater\n',''),
                              ('Error: before\n'+sentinel+'\n',''),(sentinel+'\n','Error: after'),
                              (' '+sentinel+'\n',''),(sentinel+' extra\n',''),(sentinel+'\n',sentinel)]:
            with self.assertRaises(Blocked):require_native_sentinel(stdout,stderr,sentinel)
        self.assertIsNotNone(ERROR.search('Error: honest native throw'))

    def test_real_native_exit_zero_errors_before_and_after_sentinel_rejected(self):
        environment=_environment(self.root,'runtime',APP)
        sentinel='TILESET_LAB_NATIVE_PASS TEST-ONLY-negative native_draw.js'
        for index,script in enumerate(["throw new Error('TEST_ONLY_REAL_BEFORE');", "tiled.log("+json.dumps(sentinel)+"); throw new Error('TEST_ONLY_REAL_AFTER');"]):
            path=f'negative-{index}.js'
            self.root.write(path,script.encode())
            result,text=run_owned(self.root,[APP,'--new-instance','--disable-opengl','--evaluate',self.path/path],environment,
                                  f'logs/control-{index}',sentinel=sentinel,accept_error=True)
            self.assertEqual(result['returncode'],0)
            self.assertIn('TEST_ONLY_REAL',text['stdout']+text['stderr'])
            self.assertTrue(result['complete'])
            with self.assertRaises(Blocked):require_native_sentinel(text['stdout'],text['stderr'],sentinel)
            # Persist the real control's exact complete parser rejection evidence.
            self.root.write(f'logs/control-{index}.rejected.json',json_bytes({'status':'REJECTED','test_only':True,'command':result}))

    def test_bounded_native_logs_overflow_reject_even_apparent_success(self):
        command=[sys.executable,'-c',"import sys; sys.stdout.buffer.write(b'x'*(16*1024*1024+1));sys.stdout.flush()"]
        with self.assertRaisesRegex(Blocked,'overflow|timeout'):
            run_owned(self.root,command,{**os.environ,'PYTHONDONTWRITEBYTECODE':'1'},'logs/overflow',timeout=10)
        self.assertEqual((self.path/'logs/overflow.stdout.log').stat().st_size,16*1024*1024)

    def test_real_runtime_identity_hashes_binary_qt_tiled_plugin_host_dependencies(self):
        identity=runtime_content(APP)
        self.assertEqual(identity['machine'],'x86_64')
        self.assertEqual(identity['route'],'xcb')
        paths=identity['files']
        self.assertIn(str(APP),paths)
        self.assertIn(str(APP.parent/'usr/bin/tiled'),paths)
        self.assertIn(str(APP.parent/'usr/lib/libtiled.so'),paths)
        self.assertIn(str(APP.parent/'usr/lib/libQt6Gui.so.6'),paths)
        self.assertIn(str(APP.parent/'usr/plugins/platforms/libqxcb.so'),paths)
        self.assertTrue(any('/usr/lib64/' in p for p in paths))

    def test_cli_private_group_ready_before_release_and_cancel_no_worker_leak(self):
        copy_fixture(self.path/'consumer',16)
        root=self.path/'consumer'
        ready_read,ready_write=os.pipe();release_read,release_write=os.pipe()
        env={**os.environ,'PYTHONPATH':str(PACKAGE/'python'),'PYTHONDONTWRITEBYTECODE':'1',
             'TILESET_LAB_READY_FD':str(ready_write),'TILESET_LAB_RELEASE_FD':str(release_read)}
        command=[sys.executable,'-m','tileset_lab','inspect','--project-root',str(root),'--manifest','manifest.json',
                 '--inspection-id','cancelled','--initialize-inventory']
        worker=subprocess.Popen(command,env=env,cwd='/tmp',stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(ready_write,release_read))
        os.close(ready_write);os.close(release_read)
        try:
            with os.fdopen(ready_read,'rb') as stream:ready=parse_json(stream.read(4096),'private readiness')
            self.assertEqual(ready,{'schema_version':1,'pid':worker.pid,'pgid':worker.pid,'status':'READY'})
            self.assertFalse((root/'outputs/inspections/cancelled').exists())
            self.assertEqual(os.getpgid(worker.pid),worker.pid)
            worker.send_signal(signal.SIGTERM)
            stdout,stderr=worker.communicate(timeout=10)
            self.assertEqual(worker.returncode,130,(stdout,stderr))
            report=parse_json(stdout,'cancelled CLI report');check_report(report)
            self.assertEqual(report['status'],'CANCELLED')
            self.assertFalse(report['selected'])
            with self.assertRaises(ProcessLookupError):os.killpg(worker.pid,0)
            self.assertFalse((root/'outputs/inspections/cancelled').exists())
        finally:
            os.close(release_write)
            if worker.poll() is None:worker.kill();worker.communicate()

    def test_owned_group_term_resistant_descendant_is_killed_and_awaited(self):
        script = """import os,sys,subprocess
from pathlib import Path
from tileset_lab.native import invocation_group,run_owned
from tileset_lab.manifest import Root
with invocation_group():
 root=Root(sys.argv[1])
 try:
  child_code='import signal,time,os,sys;signal.signal(signal.SIGTERM,signal.SIG_IGN);open(sys.argv[1],"w").write(str(os.getpid()));time.sleep(300)'
  code='import subprocess,sys,time; p=subprocess.Popen([sys.executable,"-c",'+repr(child_code)+',sys.argv[1]]);time.sleep(300)'
  run_owned(root,[sys.executable,'-c',code,sys.argv[1]+'/descendant.pid'],dict(os.environ),'logs/owned',timeout=300)
 finally:root.close()
"""
        env={**os.environ,'PYTHONPATH':str(PACKAGE/'python'),'PYTHONDONTWRITEBYTECODE':'1'}
        worker=subprocess.Popen([sys.executable,'-c',script,str(self.path)],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        try:
            deadline=time.monotonic()+10
            marker=self.path/'descendant.pid'
            while not marker.exists() and time.monotonic()<deadline:
                if worker.poll() is not None:break
                time.sleep(.02)
            self.assertTrue(marker.exists())
            descendant=int(marker.read_text())
            self.assertEqual(os.getpgid(worker.pid),worker.pid)
            self.assertEqual(os.getpgid(descendant),worker.pid)
            worker.send_signal(signal.SIGTERM)
            worker.communicate(timeout=10)
            deadline=time.monotonic()+3
            while Path(f'/proc/{descendant}').exists() and time.monotonic()<deadline:time.sleep(.02)
            self.assertFalse(Path(f'/proc/{descendant}').exists(),'Owned TERM-resistant descendant must be awaited, not left zombie/leaking')
            with self.assertRaises(ProcessLookupError):os.killpg(worker.pid,0)
        finally:
            if worker.poll() is None:
                os.killpg(worker.pid,signal.SIGKILL);worker.communicate()


class BoundedReportTests(unittest.TestCase):
    def test_single_v2_schema_genuine_counts_nested_source_trust_and_paths(self):
        full={'status':'CANDIDATE_TEST_ONLY','consumer':'unit-consumer','id':'candidate','selected':False,
              'source_approval':{'path':'reviews/source.json','sha256':'a'*64,'test_only':True,'actual_visual_approval':False},
              'tool_sha256':'b'*64,'counts':{'native_stages':2856},'owned_paths':['outputs/candidates/candidate']}
        report=bounded_report('build','candidate','/tmp/unit-consumer','manifest.json',full,
                              {'path':'outputs/invocations/run/report.json','sha256':'c'*64}, {'pid':123,'pgid':123})
        self.assertEqual(report['schema_version'],2)
        self.assertTrue(report['source_approval']['test_only'])
        self.assertFalse(report['native_visual_approval'])
        self.assertEqual(report['counts']['native_stages'],2856)
        for key,value in [('extra',1),('selected',True),('native_visual_approval',True),('schema_version',True)]:
            wrong=deepcopy(report);wrong[key]=value
            with self.assertRaises(Blocked):check_report(wrong)
        wrong=deepcopy(report);wrong['artifacts'][0]['path']='../foreign'
        with self.assertRaises(Blocked):check_report(wrong)
        wrong=deepcopy(report);wrong['counts']['native_stages']=True
        with self.assertRaises(Blocked):check_report(wrong)
        wrong=deepcopy(report);wrong['owned_paths']=['outputs/one']*129
        with self.assertRaises(Blocked):check_report(wrong)

    def test_cli_requires_root_manifest_candidate_review_receipt_and_exclusive_publish(self):
        from tileset_lab.__main__ import arguments
        for argv in [['build','--project-root','/tmp/x','--manifest','manifest.json','--candidate-id','x','--publish-candidate','y'],
                     ['validate','--project-root','/tmp/x','--manifest','manifest.json','--candidate-id','x']]:
            with self.assertRaises(Blocked):arguments(argv)
        args=arguments(['validate','--project-root','/tmp/x','--manifest','manifest.json','--candidate-id','x','--review','reviews/native.json','--receipt-id','current'])
        self.assertEqual(args.review,'reviews/native.json')
        self.assertEqual(args.receipt_id,'current')


if __name__=='__main__':unittest.main()
