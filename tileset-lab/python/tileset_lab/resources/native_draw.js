// Tiled 1.12.2 actual stock-default incremental Wang edits. No GUI automation.
var root = tiled.scriptArguments[0];
var planPath = tiled.scriptArguments[1];
var token = tiled.scriptArguments[2];
function check(ok, message) { if (!ok) throw new Error(message); }
function readJson(path) {
    var f = new TextFile(path, TextFile.ReadOnly);
    var content = f.readAll(); f.close(); return JSON.parse(content);
}
function writeJson(path, value) {
    check(!File.exists(path), 'Refuse existing native record ' + path);
    var f = new TextFile(path, TextFile.WriteOnly);
    f.write(JSON.stringify(value) + '\n'); f.commit();
    check(JSON.stringify(readJson(path)) === JSON.stringify(value), 'Native JSON commit/readback');
}
function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function wang(mask, mode) {
    var b = mode === 'opaque' ? 2 : 0;
    return [0, mask & 2 ? 1 : b, 0, mask & 4 ? 1 : b,
            0, mask & 8 ? 1 : b, 0, mask & 1 ? 1 : b];
}
function maskAt(field, x, y) {
    return field[y][x] + 2*field[y][x+1] + 4*field[y+1][x+1] + 8*field[y+1][x];
}
var plan = readJson(planPath);
check(tiled.version === '1.12.2' && plan.schema_version === 1 && plan.cells === 12, 'Native capability/plan');
var format = tiled.mapFormat('tmx');
check(format, 'TMX reader/writer unavailable');
var records = [], exhaustive = [], rawControls = [], unmatched = null;
function tileState(layer, ts, ws, width, height) {
    var ids = [], flags = [], nativeMasks = [], identities = [];
    for (var y = 0; y < height; y++) for (var x = 0; x < width; x++) {
        var t = layer.tileAt(x, y);
        ids.push(t ? t.id : null); flags.push(layer.flagsAt(x, y));
        nativeMasks.push(t ? ws.wangId(t) : [0,0,0,0,0,0,0,0]);
        identities.push(t ? t.tileset.fileName : null);
        check(!t || t.tileset === ts, 'Foreign native tileset at ' + x + ',' + y);
    }
    return {ids: ids, flags: flags, wang_ids: nativeMasks, tilesets: identities};
}
function outside(layer) {
    var box = layer.region().boundingRect;
    var found = [];
    for (var y = box.y; y < box.y+box.height; y++) for (var x = box.x; x < box.x+box.width; x++) {
        if (x >= 0 && x < 12 && y >= 0 && y < 12) continue;
        var tile = layer.tileAt(x, y);
        if (tile) found.push({x:x, y:y, id:tile.id, flags:layer.flagsAt(x,y), tileset:tile.tileset.fileName});
    }
    return found;
}
function verify(map, layer, ts, ws, family, field, label) {
    check(map.width === 12 && map.height === 12 && !map.infinite && map.tileWidth === plan.cell_size && map.tileHeight === plan.cell_size,
          label + ': finite native dimensions');
    check(layer.width === 12 && layer.height === 12 && layer.visible && layer.opacity === 1,
          label + ': native layer geometry/visibility');
    var state = tileState(layer, ts, ws, 12, 12);
    for (var y = 0; y < 12; y++) for (var x = 0; x < 12; x++) {
        var index = y*12+x, mask = maskAt(field,x,y), local = family.mask_ids[String(mask)];
        check(state.ids[index] === local, label + ': native no-match/ID at ' + x + ',' + y + ' expected ' + local + ' got ' + state.ids[index]);
        check(state.flags[index] === 0, label + ': native transformation flags');
        check(equal(state.wang_ids[index], local === null ? [0,0,0,0,0,0,0,0] : wang(mask, family.mode)), label + ': actual parsed native Wang mismatch');
    }
    return state;
}
function init(family) {
    var map = format.read(root + '/' + family.bootstrap);
    check(map !== null, 'External TSX bootstrap read');
    map.layerDataFormat = TileMap.CSV;
    var ts = map.tilesets[family.terrain_tileset_index];
    check(ts.fileName === root + '/' + family.tsx && ts.wangSets.length === 1, 'External TSX native identity');
    var ws = ts.wangSets[0];
    check(ws.type === WangSet.Corner && ws.colorCount === (family.mode === 'opaque' ? 2 : 1), 'Actual native mode/colors');
    check((ts.transformationFlags & (Tileset.AllowFlipHorizontally|Tileset.AllowFlipVertically|Tileset.AllowRotate)) === 0, 'Native transforms enabled');
    var seen = {};
    for (var m = 0; m < 16; m++) {
        var local = family.mask_ids[String(m)];
        if (local === null) { check(m === 0 && family.mode === 'alpha', 'Wrong null candidate'); continue; }
        check(!seen[local] && equal(ws.wangId(ts.tile(local)), wang(m, family.mode)), 'Missing/duplicate/incorrect actual native candidate ' + m);
        seen[local] = true;
    }
    check(Object.keys(seen).length === ts.tileCount, 'Extra native candidate');
    var layer = map.layerAt(family.terrain_layer_index);
    var seed = layer.edit();
    for (var y = 0; y < 12; y++) for (var x = 0; x < 12; x++)
        seed.setTile(x, y, family.mode === 'opaque' ? ts.tile(family.mask_ids['0']) : null);
    seed.apply();
    return {map:map, layer:layer, ts:ts, ws:ws};
}
function groundState(map, family) {
    if (family.mode !== 'alpha') return null;
    var ground = map.layerAt(0), rows = [];
    for (var y = 0; y < 12; y++) for (var x = 0; x < 12; x++) {
        var tile = ground.tileAt(x,y);
        check(tile && tile.tileset.fileName === root + '/' + family.ground_tsx && ground.flagsAt(x,y) === 0, 'Ground identity changed');
        rows.push(tile.id);
    }
    check(ground.visible && ground.opacity === 1, 'Ground visibility changed');
    return rows;
}
function actualNoMatch(image, size) {
    var ts = new Tileset('TEST-ONLY native uniform-only negative control');
    ts.setTileSize(size,size); ts.imageFileName = root + '/' + image;
    ts.transformationFlags = Tileset.NoTransformation;
    var ws = ts.addWangSet('TEST-ONLY incomplete candidates', WangSet.Corner);
    ws.colorCount = 2;
    ws.setWangId(ts.tile(0), wang(0,'opaque'));
    ws.setWangId(ts.tile(15), wang(15,'opaque'));
    var map = new TileMap(); map.setSize(1,1); map.tileWidth=size; map.tileHeight=size; map.addTileset(ts);
    var layer = new TileLayer('actual unmatched requests'); layer.width=1;layer.height=1;map.addLayer(layer);
    function attempt() {
        var edit=layer.wangEdit(ws);edit.correctionsEnabled=true;edit.erasingEnabled=true;
        var id=wang(1,'opaque');
        for(var k of [7,1,3,5]) edit.setWangIndex(0,0,k,id[k]);
        edit.apply();
    }
    attempt(); var blank=layer.tileAt(0,0);
    check(blank===null, 'No-match blank must remain blank');
    var seed=layer.edit();seed.setTile(0,0,ts.tile(15));seed.apply();
    attempt();var old=layer.tileAt(0,0);
    check(old && old.id===15 && !equal(ws.wangId(old),wang(1,'opaque')), 'No-match seeded old tile is NOT native success');
    var positive=layer.wangEdit(ws); positive.correctionsEnabled=true;positive.erasingEnabled=true;
    for(var k of [7,1,3,5]) positive.setWangIndex(0,0,k,2);
    positive.apply(); check(layer.tileAt(0,0).id===0, 'Available positive request must solve');
    return {blank:null, seeded_old_id:old.id, requested:wang(1,'opaque'), seeded_wang:wang(15,'opaque'), positive_id:0, verdict:'REJECTED_NONMATCHING_REQUEST'};
}
for (var family of plan.families) {
    if (unmatched === null) unmatched=actualNoMatch(family.control_atlas, plan.cell_size);
    // WangFiller::apply clips its solve/correction region on finite maps. That
    // does NOT constrain raw TileLayer storage: TileLayerEdit can retain cells
    // outside its nominal dimensions. Use a known available full-A tile, not
    // an outside corner solve whose null result cannot prove storage clipping.
    var raw=init(family), rawEdit=raw.layer.edit();
    rawEdit.setTile(-1,-1,raw.ts.tile(family.mask_ids['15']));rawEdit.apply();
    var escaped=outside(raw.layer);
    check(escaped.length===1 && escaped[0].x===-1 && escaped[0].y===-1 && escaped[0].id===family.mask_ids['15'] && escaped[0].flags===0,
          'Raw TileLayerEdit did not retain the positive outside-storage control');
    check(raw.map.width===12 && raw.map.height===12 && !raw.map.infinite && raw.layer.width===12 && raw.layer.height===12,
          'Raw storage control changed nominal finite dimensions');
    rawControls.push({pack:family.pack,family:family.family,api:'TileLayer.edit/setTile/apply',finite_dimensions:[12,12],outside_state:escaped,adapter_applied:false});
    for (var recipe of plan.cases) {
        var actual=init(family), map=actual.map, layer=actual.layer, ts=actual.ts, ws=actual.ws;
        var ground=groundState(map,family);
        for (var stage of recipe.stages) {
            var accepted=stage.raw_requests.filter(function(r){return r[0]>=0 && r[0]<=12 && r[1]>=0 && r[1]<=12;});
            check(equal(accepted,stage.accepted_requests),'Request clipping differs from independent declaration');
            if (stage.raw_requests.length) {
                var edit=layer.wangEdit(ws);edit.correctionsEnabled=true;edit.erasingEnabled=true;
                for(var request of accepted) edit.setCorner(request[0],request[1],request[2] ? 1 : family.mode==='opaque' ? 2 : 0);
                edit.apply();
            }
            var before=tileState(layer,ts,ws,12,12), pruned=outside(layer);
            if(pruned.length) {
                var clip=layer.edit();for(var cell of pruned) clip.setTile(cell.x,cell.y,null);clip.apply();
            }
            check(equal(before,tileState(layer,ts,ws,12,12)), 'Clipping changed in-bounds actual IDs/flags');
            check(outside(layer).length===0,'Adapter retained outside native cells');
            var identity=family.pack+'/'+family.family+'/'+recipe.id+'/'+stage.id;
            var state=verify(map,layer,ts,ws,family,stage.expected_field,identity);
            check(equal(ground,groundState(map,family)),'Incremental alpha erase changed ground cells');
            map.setProperty('draw_identity',identity);map.setProperty('expected_field_sha256',stage.field_sha256);
            var stem=root+'/'+plan.output+'/'+identity;
            check(!File.exists(stem+'.tmx'),'Refuse existing native stage');
            var error=format.write(map,stem+'.tmx');check(!error,'Native TMX write: '+error);
            var reopened=format.read(stem+'.tmx');check(reopened!==null,'Native saved TMX reopen failed');
            var reopenedTs=reopened.tilesets[family.terrain_tileset_index];
            check(reopenedTs.fileName===ts.fileName && reopened.property('draw_identity')===identity,
                  'Native saved identity/relative external TSX changed');
            var reopenedState=verify(reopened,reopened.layerAt(family.terrain_layer_index),reopenedTs,reopenedTs.wangSets[0],family,stage.expected_field,identity+'/readback');
            check(equal(state,reopenedState) && equal(ground,groundState(reopened,family)), 'Complete native save/readback differs');
            var record={schema_version:1,id:identity,case:recipe.id,stage:stage.id,pack:family.pack,family:family.family,mode:family.mode,
                        field_sha256:stage.field_sha256,recipe_sha256:recipe.recipe_sha256,raw_requests:stage.raw_requests,
                        accepted_requests:accepted,captured_prior:stage.captured_prior,pruned_outside:pruned,
                        in_bounds_unchanged_by_clip:true,corrections_enabled:true,erasing_enabled:true,
                        cells:state,ground_ids:ground,readback_equal:true,width:12,height:12,tmx:plan.output+'/'+identity+'.tmx'};
            writeJson(stem+'.record.json',record);
            records.push({id:identity,tmx:record.tmx,record:plan.output+'/'+identity+'.record.json'});
        }
    }
    var proofs={pack:family.pack,family:family.family,mode:family.mode,masks:[],neighborhoods:[],partial:[]};
    for(var bits=0;bits<512;bits++) {
        var scratch=init(family), edit=scratch.layer.wangEdit(scratch.ws);edit.correctionsEnabled=true;edit.erasingEnabled=true;
        var field=[];for(var y=0;y<13;y++) field.push(Array(13).fill(0));
        for(var i=0;i<9;i++) {var x=5+i%3,y=5+Math.floor(i/3),value=(bits>>i)&1;field[y][x]=value;edit.setCorner(x,y,value?1:family.mode==='opaque'?2:0);}
        edit.apply();var clip=scratch.layer.edit();for(var cell of outside(scratch.layer))clip.setTile(cell.x,cell.y,null);clip.apply();
        verify(scratch.map,scratch.layer,scratch.ts,scratch.ws,family,field,'neighborhood-'+bits);
        proofs.neighborhoods.push({bits:bits,actual_masks:[maskAt(field,5,5),maskAt(field,6,5),maskAt(field,5,6),maskAt(field,6,6)]});
    }
    for(var mask=0;mask<16;mask++) {
        var scratch=init(family), edit=scratch.layer.wangEdit(scratch.ws);edit.correctionsEnabled=true;edit.erasingEnabled=true;
        var corners=[[6,6],[7,6],[7,7],[6,7]];
        for(var i=0;i<4;i++)edit.setCorner(corners[i][0],corners[i][1],mask&(1<<i)?1:family.mode==='opaque'?2:0);
        edit.apply();var tile=scratch.layer.tileAt(6,6);
        check((tile?tile.id:null)===family.mask_ids[String(mask)],'Actual native all-mask proof failed');
        proofs.masks.push({mask:mask,id:tile?tile.id:null,wang:tile?scratch.ws.wangId(tile):[0,0,0,0,0,0,0,0]});
    }
    for(var number=0;number<81;number++) {
        var scratch=init(family), edit=scratch.layer.wangEdit(scratch.ws);edit.correctionsEnabled=false;edit.erasingEnabled=true;
        var constraints=[],value=number,b=family.mode==='opaque'?2:0,indices=[7,1,3,5];
        for(var i=0;i<4;i++){var digit=value%3;value=Math.floor(value/3);constraints.push(digit===0?null:digit===1?1:b);if(digit)edit.setWangIndex(6,6,indices[i],digit===1?1:b);}
        edit.apply();var tile=scratch.layer.tileAt(6,6),id=tile?scratch.ws.wangId(tile):[0,0,0,0,0,0,0,0];
        check(scratch.layer.flagsAt(6,6)===0,'Partial native flags');
        for(var i=0;i<4;i++)check(constraints[i]===null || id[indices[i]]===constraints[i], 'Partial request retained a NONMATCHING old tile');
        proofs.partial.push({number:number,constraints:constraints,actual_id:tile?tile.id:null,actual_wang:id});
    }
    exhaustive.push(proofs);
    tiled.log('Native completed '+family.pack+'/'+family.family+' '+records.length+' persistent saved stages');
}
check(records.length===plan.expected_stages,'Missing/duplicate native stage inventory');
writeJson(root+'/'+plan.output+'/native-results.json',{schema_version:1,run_token:token,consumer:plan.consumer,
          expected_inventory_sha256:plan.expected_inventory_sha256,stages:records,exhaustive:exhaustive,
          raw_api_outside_controls:rawControls,unmatched_control:unmatched});
tiled.log('TILESET_LAB_NATIVE_PASS '+token+' native_draw.js');
