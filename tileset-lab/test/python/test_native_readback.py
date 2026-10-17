"""TEST-ONLY honest-byte readback and pixel rejection controls, not native approval.

These unit records exercise production readback/original-oracle predicates with
both complete consumer parsers. They do NOT represent actual Tiled draw results
or actual image viewing. Actual matrix execution remains separately gated.
"""
from __future__ import annotations

from copy import deepcopy
from itertools import product
from pathlib import Path
import tempfile
import unittest

import numpy as np
from PIL import Image

from test_core import copy_fixture, inspect, trust_record, build, set_json
from tileset_lab import drawcases, expectation
from tileset_lab.manifest import Blocked, Inputs, Root, json_bytes, load_manifest, sha256
from tileset_lab.maps import map_root, add_layer, finalize_map, properties
from tileset_lab.pixels import compare_premultiplied, premultiply, compare_visible, unpremultiply
from tileset_lab.review import file_record, freeze, verify_seal
from tileset_lab.sources import image_bytes, png_bytes
from tileset_lab.validate import _candidate, _declaration, _draw_readback, _exhaustive, _wang

CONSUMERS=Path('/tmp/tileset-lab-evidence/phase-02/consumers/unit-readback')
CONSUMERS.mkdir(parents=True,exist_ok=True)


class HonestReadbackControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory(prefix='honest-',dir=CONSUMERS)
        cls.addClassCleanup(cls.temp.cleanup)
        cls.states={}
        for size in (16,32):
            path=Path(cls.temp.name)/f'consumer-{size}'
            copy_fixture(path,size)
            packet=inspect(path,id='test-only-unit-current',initialize=True)
            trust_record(path,packet)
            build(path,id='TEST-only-candidate'.lower(),test=True)
            root=Root(path)
            cls.addClassCleanup(root.close)
            inputs=Inputs(root)
            manifest=load_manifest(inputs,'manifest.json')
            state=_candidate(inputs,manifest,'manifest.json','test-only-candidate',allow_test_trust=True)
            declared=_declaration(manifest,state)
            cls.states[size]=(root,inputs,manifest,state,declared)

    def make_stage(self,size,mode,mutation=None,stage_name='s001-point'):
        root,inputs,manifest,state,declared=self.states[size]
        item=deepcopy(next(i for i in declared['items'] if i['kind']=='draw-stage' and i['mode']==mode and i['case']=='01-n' and i['stage']==stage_name))
        case=next(c for c in declared['draw']['cases'] if c['id']=='01-n')
        stage=next(s for s in case['stages'] if s['id']==stage_name)
        original=state['terrains'][(item['pack'],item['family'])]
        masks=[m for row in expectation.intent_masks(stage['expected_field']) for m in row]
        ids=[original['mask_ids'][m] for m in masks]
        ground=next(a for (pack,_),a in state['terrains'].items() if pack==item['pack'] and a['family']['mode']=='opaque')
        record={'schema_version':1,'id':item['id'],'case':item['case'],'stage':item['stage'],'pack':item['pack'],'family':item['family'],'mode':mode,
                'field_sha256':item['field_sha256'],'recipe_sha256':item['recipe_sha256'],'raw_requests':stage['raw_requests'],
                'accepted_requests':stage['accepted_requests'],'captured_prior':stage['captured_prior'],'pruned_outside':[],
                'in_bounds_unchanged_by_clip':True,'corrections_enabled':True,'erasing_enabled':True,'readback_equal':True,
                'cells':{'ids':ids,'flags':[0]*144,'wang_ids':[[0]*8 if local is None else _wang(m,mode) for local,m in zip(ids,masks)],
                         'tilesets':[None if local is None else str(root.path/original['tsx']) for local in ids]},
                'ground_ids':[ground['mask_ids'][0]]*144 if mode=='alpha' else None,'width':12,'height':12,'tmx':item['tmx']}
        path=f"outputs/TEST-only-controls/stage-{size}-{mode}-{len(root.files('outputs'))}.tmx"
        refs=[original] if mode=='opaque' else [ground,original]
        node,gids=map_root(12,12,size,refs,path)
        properties(node,{'draw_identity':item['id'],'expected_field_sha256':item['field_sha256']})
        if mode=='alpha':add_layer(node,'ground-context',[gids[ground['tsx']]+ground['mask_ids'][0]]*144,12,12,{'entity':'ground-context'})
        add_layer(node,'persistent-terrain',[0 if local is None else gids[original['tsx']]+local for local in ids],12,12,{'entity':'persistent-terrain'})
        item['tmx']=path;record['tmx']=path
        if mutation:mutation(node,record,item)
        finalize_map(root,path,node)
        # Honest updated byte digest: rejection must be semantic, not stale hashes.
        honest=file_record(root,path)
        self.assertEqual(honest['sha256'],sha256(root.read(path)[0]))
        return root,manifest,state,item,stage,record,honest

    def test_correct_test_only_readback_schema_both_modes_sizes(self):
        for size,mode in product((16,32),('opaque','alpha')):
            args=self.make_stage(size,mode)
            _draw_readback(*args[:6])
            self.assertEqual(args[-1]['size_bytes'],len(args[0].read(args[3]['tmx'])[0]))

    def test_boolean_raw_accepted_prior_values_rejected_before_numeric_equality(self):
        for size, mode in product((16,32), ('opaque','alpha')):
            args = self.make_stage(size, mode)
            _draw_readback(*args[:6])
            for key in ('raw_requests','accepted_requests','captured_prior'):
                for column in range(3):
                    record = deepcopy(args[5])
                    record[key][0][column] = bool(record[key][0][column])
                    changed = (*args[:5], record)
                    with self.assertRaisesRegex(Blocked, 'strict integer'):_draw_readback(*changed)

    def test_honest_null_opaque_wrong_ids_flags_identity_and_missing_stage_reject(self):
        def null(node,record,item):
            layer=node.findall('layer')[-1]
            data=[int(v) for v in layer.find('data').text.split(',')]
            index=next(i for i,v in enumerate(data) if v)
            data[index]=0;layer.find('data').text=','.join(map(str,data))
            record['cells']['ids'][index]=None
            record['cells']['wang_ids'][index]=[0]*8
            record['cells']['tilesets'][index]=None
        def flags(node,record,item):
            layer=node.findall('layer')[-1]
            data=[int(v) for v in layer.find('data').text.split(',')];data[0]|=0x80000000
            layer.find('data').text=','.join(map(str,data));record['cells']['flags'][0]=0x80000000
        def old_stage(node,record,item):
            record['stage']='s000-seed'
        def hidden(node,record,item):node.findall('layer')[-1].set('visible','0')
        def outside_prune(node,record,item):record['pruned_outside']=[{'x':6,'y':6,'id':15,'flags':0,'tileset':'wrong'}]
        for size in (16,32):
            for mutate in (null,flags,old_stage,hidden,outside_prune):
                args=self.make_stage(size,'opaque',mutate)
                with self.assertRaises(Blocked):_draw_readback(*args[:6])

    def test_honest_alpha_ground_mutation_and_not_null_erase_reject(self):
        def ground(node,record,item):
            layer=node.findall('layer')[0]
            data=[int(v) for v in layer.find('data').text.split(',')]
            data[0]+=1;layer.find('data').text=','.join(map(str,data));record['ground_ids'][0]+=1
        def not_null(node,record,item):
            record['cells']['ids'][0]=0;record['cells']['wang_ids'][0]=_wang(1,'alpha')
            record['cells']['tilesets'][0]=record['cells']['tilesets'][65]
        for size in (16,32):
            for mutate in (ground,not_null):
                args=self.make_stage(size,'alpha',mutate)
                with self.assertRaises(Blocked):_draw_readback(*args[:6])

    def test_frozen_previous_stage_current_id_honest_bytes_wrong_masks_reject(self):
        def copied(node,record,item):
            # Honest current identity but old seed pixels/GIDs. Labels cannot pass.
            layer=node.findall('layer')[-1]
            data=[int(v) for v in layer.find('data').text.split(',')]
            background=data[0]
            layer.find('data').text=','.join([str(background)]*144)
        for size in (16,32):
            args=self.make_stage(size,'opaque',copied)
            with self.assertRaisesRegex(Blocked,'serialized'):_draw_readback(*args[:6])

    def test_honest_wrong_source_role_quarter_alpha_boundary_wrap_and_previous_pixels(self):
        for size in (16,32):
            root,inputs,manifest,state,declared=self.states[size]
            for key,a in state['terrains'].items():
                roles={r['role']:image_bytes(inputs.read(r['image']),r['image']) for r in state['frozen'][key]['roles']}
                expected=expectation.original_patterns(roles,size,a['family']['mode'])
                wrong=deepcopy(roles);wrong['concave-NW']=roles['convex-NW'].copy()
                altered=expectation.original_patterns(wrong,size,a['family']['mode'])
                changed=[m for m in expected if not np.array_equal(premultiply(expected[m]),premultiply(altered[m]))]
                self.assertTrue(changed)
                for mask in changed:
                    with self.assertRaises(Blocked):compare_premultiplied(premultiply(expected[mask]),altered[mask],'TEST-ONLY honest wrong full-original concave role')
            opaque=next(a for a in state['terrains'].values() if a['family']['mode']=='opaque')
            field=[[0]*13 for _ in range(13)];field[0][0]=1
            buffer=expectation.draw_pixels(field,opaque['patterns'],size)
            wrong_field=[[0]*13 for _ in range(13)];wrong_field[12][12]=1
            flipped=expectation.draw_pixels(wrong_field,opaque['patterns'],size)
            with self.assertRaises(Blocked):compare_premultiplied(buffer,unpremultiply(flipped),'wrong boundary orientation/wrap')
            blank=expectation.draw_pixels([[0]*13 for _ in range(13)],opaque['patterns'],size)
            with self.assertRaises(Blocked):compare_premultiplied(buffer,unpremultiply(blank),'previous seed frozen into paint stage')
            alpha=next(a for a in state['terrains'].values() if a['family']['mode']=='alpha')
            values=premultiply(alpha['patterns'][15])
            picture=alpha['patterns'][15].copy()
            y,x=np.argwhere(np.asarray(picture)[:,:,3]>0)[0]
            r,g,b,a=picture.getpixel((int(x),int(y)))
            picture.putpixel((int(x),int(y)),(r,g,b,(a+1)%256))
            with self.assertRaises(Blocked):compare_premultiplied(values,picture,'honest wrong authored alpha channel')

    def test_original_elapsed_boundary_wrap_wrong_phase_is_rejected(self):
        for size in (16,32):
            root,inputs,manifest,state,declared=self.states[size]
            playback=next(d for d in state['descriptions'] if d['kind']=='playback')
            at,_=expectation.reconstruct(playback,size,70)
            after,_=expectation.reconstruct(playback,size,71)
            self.assertFalse(np.array_equal(at,after))
            with self.assertRaises(Blocked):compare_premultiplied(at,unpremultiply(after),'wrong strict 70ms boundary')
            wrap,_=expectation.reconstruct(playback,size,241)
            frozen,_=expectation.reconstruct(playback,size,200)
            with self.assertRaises(Blocked):compare_premultiplied(wrap,unpremultiply(frozen),'wrong variable wrap')

    def proofs(self,state):
        exhaustive=[];controls=[]
        for (pack,family),a in state['terrains'].items():
            mode=a['family']['mode'];b=2 if mode=='opaque' else 0
            proof={'pack':pack,'family':family,'mode':mode,
                   'masks':[{'mask':m,'id':a['mask_ids'][m],'wang':[0]*8 if a['mask_ids'][m] is None else _wang(m,mode)} for m in range(16)],
                   'neighborhoods':[], 'partial':[]}
            for bits in range(512):
                grid=[[(bits>>(y*3+x))&1 for x in range(3)] for y in range(3)]
                proof['neighborhoods'].append({'bits':bits,'actual_masks':[m for row in expectation.intent_masks(grid) for m in row]})
            for number in range(81):
                remaining=number;constraints=[]
                for _ in range(4):
                    digit,remaining=remaining%3,remaining//3
                    constraints.append(None if digit==0 else 1 if digit==1 else b)
                allowed=[m for m in range(16) if all(v is None or v==(1 if m&(1<<i) else b) for i,v in enumerate(constraints))]
                mask=allowed[0]
                proof['partial'].append({'number':number,'constraints':constraints,'actual_id':a['mask_ids'][mask],
                                         'actual_wang':[0]*8 if a['mask_ids'][mask] is None else _wang(mask,mode)})
            exhaustive.append(proof)
            controls.append({'pack':pack,'family':family,'api':'TileLayer.edit/setTile/apply','finite_dimensions':[12,12],
                             'adapter_applied':False,'outside_state':[{'x':-1,'y':-1,'id':a['mask_ids'][15],'flags':0,'tileset':a['tsx']}]})
        return {'exhaustive':exhaustive,'raw_api_outside_controls':controls,
                'unmatched_control':{'blank':None,'seeded_old_id':15,'requested':_wang(1,'opaque'),'seeded_wang':_wang(15,'opaque'),
                                     'positive_id':0,'verdict':'REJECTED_NONMATCHING_REQUEST'}}

    def test_all_16_512_81_parser_coverage_and_native_allowed_not_nonempty_old(self):
        for size in (16,32):
            root,inputs,manifest,state,declared=self.states[size]
            correct=self.proofs(state)
            _exhaustive(state,correct)
            mutations=[]
            wrong=deepcopy(correct);wrong['exhaustive'][0]['neighborhoods'].pop();mutations.append(wrong)
            wrong=deepcopy(correct);wrong['exhaustive'][0]['partial'].append(wrong['exhaustive'][0]['partial'][0]);mutations.append(wrong)
            wrong=deepcopy(correct);wrong['exhaustive'][0]['masks'].pop();mutations.append(wrong)
            wrong=deepcopy(correct);wrong['raw_api_outside_controls'][0]['outside_state']=[];mutations.append(wrong)
            wrong=deepcopy(correct);wrong['exhaustive'][0]['masks'][1]['mask']=True;mutations.append(wrong)
            wrong=deepcopy(correct);wrong['exhaustive'][0]['partial'][1]['constraints'][0]=True;mutations.append(wrong)
            for key,index in (('positive_id',None),('requested',7),('seeded_wang',1)):
                wrong=deepcopy(correct)
                if index is None:wrong['unmatched_control'][key]=False
                else:wrong['unmatched_control'][key][index]=True
                mutations.append(wrong)
            wrong=deepcopy(correct)
            # Constraint 1 at NW cannot be satisfied by a retained nonempty B tile.
            partial=wrong['exhaustive'][0]['partial'][1]
            partial['actual_id']=0;partial['actual_wang']=_wang(0,'opaque');mutations.append(wrong)
            for wrong in mutations:
                with self.assertRaises(Blocked):_exhaustive(state,wrong)

    def test_seal_snapshot_and_closed_original_scope_reject_honest_metadata_or_membership_change(self):
        from tileset_lab.native import runtime_content
        for size in (16,32):
            root,inputs,manifest,state,declared=self.states[size]
            native=state['native_directory']
            root.mkdir(native)
            root.write(native+'/TEST-only-coverage.json',json_bytes({'TEST-ONLY':'parser fixture, no native execution/viewing'}))
            root.write(native+'/TEST-only-computation.json',json_bytes({'TEST-ONLY':'parser fixture, no native proof'}))
            root.write(native+'/TEST-only-runtime.json',json_bytes(runtime_content(manifest['tiled_runtime'])))
            record,seal=freeze(inputs,manifest,state['candidate'],state['directory'],native+'/TEST-only-coverage.json',
                               native+'/TEST-only-computation.json',native+'/TEST-only-runtime.json',state['approval'],'TEST-ONLY seal parser producer')
            fresh=Inputs(root)
            actual,_=verify_seal(fresh,manifest,state['candidate'],record['path'])
            self.assertEqual(actual,record)
            # All bundle hashes remain honest: metadata/inode replacement alone
            # must invalidate the already checked exact seal snapshot.
            saved=(root.path/record['path']).read_bytes()
            changed=deepcopy(seal);changed['producer']='TEST-ONLY modified producer, unchanged exact payload'
            (root.path/record['path']).write_bytes(json_bytes(changed))
            with self.assertRaisesRegex(Blocked,'changed/replaced'):
                verify_seal(fresh,manifest,state['candidate'],record['path'])
            (root.path/record['path']).write_bytes(saved)
            foreign=root.path/'originals/TEST-only-undeclared.txt'
            foreign.write_bytes(b'TEST-ONLY newly appeared original; every previous file hash still correct')
            try:
                with self.assertRaises(Blocked):verify_seal(Inputs(root),manifest,state['candidate'],record['path'])
            finally:foreign.unlink()  # This isolated temporary test created it.

    def test_complete_original_contexts_crops_pages_and_all_variable_default_probes_declared(self):
        for size in (16,32):
            root,inputs,manifest,state,declared=self.states[size]
            draw=[i for i in declared['items'] if i['kind']=='draw-stage']
            contexts=[i for i in declared['items'] if i['kind']!='draw-stage']
            self.assertEqual(len(draw),2856)
            self.assertEqual(len(contexts),75)
            self.assertEqual({i['kind'] for i in contexts},{'source-inventory','playback','terrain-masks','complete-parts','terrain-pattern','scene'})
            for item in contexts:
                self.assertGreater(len(item['crops']),0)
                self.assertEqual({p['context'] for p in item['pages']},{'checker','ground'})
                self.assertTrue(all(p['pixel_rect'][2]<=600 and p['pixel_rect'][3]<=600 for p in item['pages']))
            probes={c['elapsed_ms'] for c in declared['contexts'] if c['elapsed_ms']}
            self.assertTrue({69,70,71,199,200,201,239,240,241,99,100,101}.issubset(probes))
            self.assertEqual(len({i['id'] for i in declared['items']}),2931)


if __name__=='__main__':unittest.main()
