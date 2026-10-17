"""TEST-ONLY transport/race/failure controls. No native or image approval.

The CLI finalization tests replace only the publication authorization seam with
an explicitly synthetic selector operation. They exercise real CLI locks,
process ownership, selector recovery, report I/O and cancellation. They NEVER
create real source/native review records or publication receipts. Full real
production publication still requires the separate actual image reviewer.
"""
from __future__ import annotations

from copy import deepcopy
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from test_core import copy_fixture
from tileset_lab.manifest import Blocked, Root, json_bytes, parse_json, sha256
from tileset_lab.report import bounded_report, check_report
from tileset_lab.review import file_record
from tileset_lab.validate import _command, _native_map_export, _native_registrations

PACKAGE=Path(__file__).resolve().parents[2]
ENV={**os.environ,'PYTHONPATH':str(PACKAGE/'python'),'PYTHONDONTWRITEBYTECODE':'1'}

# TEST-ONLY authorization double; not native acceptance or a production receipt.
WORKER=r'''
import io,os,signal,sys,subprocess
from pathlib import Path
from tileset_lab import __main__,review
from tileset_lab.manifest import Root,json_bytes
from tileset_lab.native import _CHILDREN
root_path,kind=sys.argv[1:]
original_write=Root.write
fired=False
class OnceBroken(io.BytesIO):
    def write(self,value):
        global fired
        if not fired:
            fired=True
            raise BrokenPipeError('TEST-ONLY stdout delivery failure')
        return super().write(value)
if kind=='stdout':
    target=OnceBroken()
    class Output:
        buffer=target
        def flush(self):self.buffer.flush()
    sys.stdout=Output()
if kind=='bounded':
    from tileset_lab import report
    factory=report.bounded_report
    def bounded(*args):
        if args[4]['status']=='PUBLISHED':
            raise ValueError('TEST-ONLY bounded final-report failure')
        return factory(*args)
    report.bounded_report=bounded

def write(self,path,content):
    global fired
    if '/invocations/' in path and path.endswith('/report.json') and kind in ('write','cancel') and not fired:
        fired=True
        if kind=='write':
            raise OSError('TEST-ONLY invocation report write failure')
        os.kill(os.getpid(),signal.SIGTERM)
    return original_write(self,path,content)
Root.write=write
if kind=='late-close':
    original_close=Root.close
    def close(self):
        original_close(self)
        os.kill(os.getpid(),signal.SIGTERM)
    Root.close=close
if kind=='one-settlement':
    from tileset_lab import native
    original_settle=native.settle_owned
    calls=0
    def once():
        global calls
        calls+=1
        if calls>1:raise ValueError('TEST-ONLY redundant settlement after terminal delivery')
        return original_settle()
    native.settle_owned=once

def synthetic_select(inputs,manifest,manifest_path,candidate,receipt,*,finalize,deliver):
    root=inputs.root
    if kind=='orphan':
        code=r"""
import fcntl,os,signal,sys,time
from pathlib import Path
root=Path(sys.argv[1]);(root/'owned-descendant.pid').write_text(str(os.getpid()))
def term(*_):
    fd=os.open(root/'.tileset-lab.lock',os.O_RDWR)
    try:
        try:
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
            result='UNSAFE_UNLOCKED'
        except BlockingIOError:result='BLOCKED_BY_TRANSACTION'
        (root/'settlement-lock-evidence.txt').write_text(result)
    finally:os.close(fd)
signal.signal(signal.SIGTERM,term)
(root/'owned-descendant.ready').write_text('READY')
while True:time.sleep(.02)
"""
        child=subprocess.Popen([sys.executable,'-c',code,str(root.path)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        _CHILDREN.add(child)
        import time
        deadline=time.monotonic()+10
        while not (root.path/'owned-descendant.ready').exists():
            if time.monotonic()>deadline:raise ValueError('TEST-ONLY descendant startup failed')
            time.sleep(.01)
    full={'schema_version':1,'operation':'build','status':'PUBLISHED','consumer':manifest['id'],'id':candidate,
          'selected':True,'native_proof':True,'native_visual_approval':True,'tool_sha256':'b'*64,
          'source_approval':{'path':'TEST-ONLY/no-actual-source-review.json','sha256':'a'*64,'test_only':False,'actual_visual_approval':True},
          'counts':{},'owned_paths':['outputs/approved-selector.json'],
          'TEST_ONLY_TRANSPORT_DOUBLE':'NOT actual source/native/image approval or production publication'}
    prepared=None
    def finish():
        nonlocal prepared
        prepared=finalize(full)
        return full
    return review.select_exact(root,'outputs/approved-selector.json',b'TEST-ONLY selector transport operation\n',inputs.recheck,finish,lambda _:deliver(prepared))
review.publish_candidate=synthetic_select
rc=__main__.main(['build','--project-root',root_path,'--manifest','manifest.json','--publish-candidate','test-only-transport','--receipt','TEST-ONLY/no-receipt.json'])
if kind=='stdout':
    os.write(1,target.getvalue())
raise SystemExit(rc)
'''


class NativeTransactionControls(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='tileset-transaction-')
        self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)/'consumer'
        copy_fixture(self.path,16)
        self.originals={p.relative_to(self.path).as_posix():sha256(p.read_bytes()) for p in self.path.rglob('*') if p.is_file()}

    def preserved(self):
        for path,digest in self.originals.items():
            self.assertEqual(sha256((self.path/path).read_bytes()),digest,path)

    def cli(self,extra,flags=()):
        return subprocess.run([sys.executable,*flags,'-m','tileset_lab',*extra],env=ENV,cwd='/tmp',capture_output=True,timeout=30)

    def test_cli_usage_unsafe_manifest_and_missing_dependencies_have_bounded_failure_json(self):
        cases=[([],()),(['build'],()),(['inspect','--project-root',str(self.path),'--manifest','../unsafe','--inspection-id','unit'],()),
               (['inspect','--project-root',str(self.path),'--manifest','manifest.json','--inspection-id','unit'],('-S',))]
        for argv,flags in cases:
            run=self.cli(argv,flags)
            self.assertEqual(run.returncode,2,run.stderr)
            report=parse_json(run.stdout,'TEST-ONLY real CLI failure')
            check_report(report)
            self.assertEqual(report['status'],'BLOCKED')
            self.assertFalse(report['selected'])
            self.assertLessEqual(len(run.stdout),256*1024)
            self.preserved()

    def test_full_native_private_review_capacity_is_not_the_public_report_bound(self):
        from tileset_lab.review import REVIEW_LIMIT
        # Measured real 2,931-item fixture with 174,605 required-view records and
        # 100-character TEST-ONLY observations: UNAPPROVED/BLOCKED, not viewing.
        self.assertGreaterEqual(REVIEW_LIMIT,135_237_321)

    def test_report_rejects_action_status_proof_and_boolean_pgid_contradictions(self):
        full={'status':'CANDIDATE_TEST_ONLY','consumer':'unit','id':'candidate','selected':False,
              'source_approval':{'path':'reviews/source.json','sha256':'a'*64,'test_only':True,'actual_visual_approval':False},
              'tool_sha256':'b'*64,'counts':{},'owned_paths':[]}
        report=bounded_report('build','candidate','/tmp/unit','manifest.json',full,None,{'pid':1,'pgid':1})
        for changes in ({'operation':'inspect','action':'publish','status':'APPROVED','native_visual_approval':True},
                        {'process':{'pid':1,'pgid':True}}, {'native_proof':True}, {'status':'PUBLISHED'}, {'source_approval':None}):
            wrong={**deepcopy(report),**changes}
            with self.assertRaises(Blocked):check_report(wrong)

    def test_whole_cli_finalization_write_stdout_cancel_and_report_failures_restore_selector(self):
        for kind in ('write','stdout','cancel','bounded'):
            run=subprocess.run([sys.executable,'-c',WORKER,str(self.path),kind],env=ENV,cwd='/tmp',capture_output=True,timeout=30)
            self.assertEqual(run.returncode,130 if kind=='cancel' else 2,(kind,run.stdout,run.stderr))
            report=parse_json(run.stdout,'TEST-ONLY CLI finalization fault')
            check_report(report)
            self.assertFalse(report['selected'])
            self.assertEqual(report['status'],'CANCELLED' if kind=='cancel' else 'BLOCKED')
            self.assertFalse(Path(f"/proc/{report['process']['pid']}").exists())
            self.preserved()

    def test_cli_holds_consumer_lock_through_term_grace_kill_and_descendant_reap(self):
        run=subprocess.run([sys.executable,'-c',WORKER,str(self.path),'orphan'],env=ENV,cwd='/tmp',capture_output=True,timeout=30)
        self.assertEqual(run.returncode,0,(run.stdout,run.stderr))
        report=parse_json(run.stdout,'TEST-ONLY transport success; NOT native acceptance')
        check_report(report)
        self.assertEqual((self.path/'settlement-lock-evidence.txt').read_text(),'BLOCKED_BY_TRANSACTION')
        self.assertFalse(Path('/proc/'+(self.path/'owned-descendant.pid').read_text()).exists())
        # The synthetic transport intentionally selected only its own marker;
        # all original files and the previous approved artwork remain unchanged.
        for path,digest in self.originals.items():
            if path!='outputs/approved-selector.json':self.assertEqual(sha256((self.path/path).read_bytes()),digest,path)

    def test_completed_delivery_has_no_late_result_affecting_settlement_or_signal_exit(self):
        for kind in ('late-close','one-settlement'):
            run=subprocess.run([sys.executable,'-W','error::ResourceWarning','-c',WORKER,str(self.path),kind],env=ENV,cwd='/tmp',capture_output=True,timeout=30)
            self.assertEqual(run.returncode,0,(kind,run.stdout,run.stderr))
            report=parse_json(run.stdout,'TEST-ONLY completed transport; NOT actual approval')
            check_report(report)
            self.assertEqual(report['status'],'PUBLISHED')
            for path,digest in self.originals.items():
                if path!='outputs/approved-selector.json':self.assertEqual(sha256((self.path/path).read_bytes()),digest,path)

    def test_native_argv_and_independent_export_inventory_not_recorded_plan_labels(self):
        root=Root(self.path)
        self.addCleanup(root.close)
        for name in ('stdout','stderr'):root.write('controls/'+name+'.log',b'')
        result={'argv':['TEST-ONLY','wrong-argument'],'returncode':0,'logs':{k:file_record(root,'controls/'+k+'.log') for k in ('stdout','stderr')},
                'sentinel':None,'overflow':False,'complete':True}
        with self.assertRaisesRegex(Blocked,'arguments'):_command(root,result,argv=['TEST-ONLY','expected-argument'])
        state={'directory':'outputs/candidates/unit','native_directory':'outputs/candidates/unit/native',
               'registrations':{'one':{'tsx':'outputs/candidates/unit/tilesets/one.tsx','capacity':1}},'terrains':{},'parts':{}}
        with self.assertRaisesRegex(Blocked,'independent originals'):
            _native_registrations(root,state,{'tilesets':[]},{'tilesets':[]})

    def test_native_layer_id_boolean_is_not_integer_one(self):
        from tileset_lab.maps import map_root, add_layer, finalize_map
        root=Root(self.path)
        self.addCleanup(root.close)
        context={'key':'unit','map':'controls/unit.tmx','export':'controls/unit.tmj','width':2,'height':3,'png':'controls/unit.png'}
        node,_=map_root(2,3,16,[],context['map'])
        add_layer(node,'unit',[0]*6,2,3,{})
        finalize_map(root,context['map'],node)
        layer=node.find('layer')
        native={'width':2,'height':3,'tilewidth':16,'tileheight':16,'infinite':False,'orientation':'orthogonal','renderorder':'right-down',
                'tilesets':[],'layers':[{'id':int(layer.get('id')),'name':'unit','visible':True,'opacity':1,'type':'tilelayer','data':[0]*6}]}
        root.write(context['export'],json_bytes(native))
        row={**{k:context[k] for k in ('key','map','export')},'actual':{'path':context['png'],'dimensions':[32,48]},'stats':{'cells':0,'objects':0},'tilesets':[]}
        _native_map_export(root,context,row)
        for key,value in (('id',True),('opacity',True)):
            wrong=deepcopy(native);wrong['layers'][0][key]=value
            with patch('tileset_lab.validate._json',return_value=wrong):
                with self.assertRaises(Blocked):_native_map_export(root,context,row)

    def test_honest_wrong_context_native_png_binding_is_semantically_rejected(self):
        root=Root(self.path)
        self.addCleanup(root.close)
        root.write('controls/context.tmx',b'<map tilewidth="16" tileheight="16"/>')
        context={'key':'context-zero','map':'controls/context.tmx','export':'controls/context.tmj','width':2,'height':3,'png':'controls/native.png'}
        row={**{k:context[k] for k in ('key','map','export')},'actual':{'path':'controls/other-honest.png','dimensions':[32,48]},'stats':{},'tilesets':[]}
        with self.assertRaisesRegex(Blocked,'PNG identity'):_native_map_export(root,context,row)


if __name__=='__main__':unittest.main()
