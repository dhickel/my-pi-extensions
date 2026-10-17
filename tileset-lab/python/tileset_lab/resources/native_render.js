// Actual unannotated Tiled map renders and native external registration exports.
var root=tiled.scriptArguments[0], planPath=tiled.scriptArguments[1], token=tiled.scriptArguments[2];
function check(ok,message){if(!ok)throw new Error(message);}
function readJson(path){var f=new TextFile(path,TextFile.ReadOnly);var text=f.readAll();f.close();return JSON.parse(text);}
function writeJson(path,value){check(!File.exists(path),'Refuse existing native export');var f=new TextFile(path,TextFile.WriteOnly);f.write(JSON.stringify(value)+'\n');f.commit();check(JSON.stringify(readJson(path))===JSON.stringify(value),'Native render record persistence');}
function image(map,path,width,height){
    check(!File.exists(path),'Refuse existing native PNG');
    var rendered=map.toImage();
    check(rendered.width===width && rendered.height===height,'Native raster exact dimensions');
    check(rendered.save(path),'Native unannotated PNG export failed');
    return {path:path.substring(root.length+1),dimensions:[rendered.width,rendered.height]};
}
function inspect(parent,shown){
    var cells=0,objects=0;
    for(var layer of parent.layers){
        check(layer.opacity===1,'Native effective opacity differs');
        var visible=shown && layer.visible;
        if(layer.isTileLayer){
            for(var y=0;y<layer.height;y++)for(var x=0;x<layer.width;x++){
                check(layer.flagsAt(x,y)===0,'Native transformed layer cell');
                if(layer.tileAt(x,y)){check(visible,'Native hidden required artwork');cells++;}
            }
        }else if(layer.isObjectLayer){
            for(var object of layer.objects){
                if(object.tile){
                    check(visible && object.visible && object.rotation===0 && !object.tileFlippedHorizontally && !object.tileFlippedVertically,'Native hidden/transformed required object');
                    objects++;
                }
            }
        }else if(layer.isGroupLayer){var nested=inspect(layer,visible);cells+=nested.cells;objects+=nested.objects;}
        else check(false,'Unsupported native layer');
    }
    return {cells:cells,objects:objects};
}
var plan=readJson(planPath);
check(tiled.version==='1.12.2' && plan.schema_version===1,'Pinned native capability');
var tmx=tiled.mapFormat('tmx'),jsonMap=tiled.mapFormat('json'),tsx=tiled.tilesetFormat('tsx'),jsonTiles=tiled.tilesetFormat('json');
check(tmx && jsonMap && tsx && jsonTiles,'Actual native format capabilities unavailable');
var stages=[],contexts=[],tilesets=[];
for(var stage of plan.stages){
    var map=tmx.read(root+'/'+stage.tmx);
    check(map!==null && map.width===12 && map.height===12 && !map.infinite,'Native stage readback dimensions');
    check(map.property('draw_identity')===stage.id && map.property('expected_field_sha256')===stage.field_sha256,'Wrong/frozen native stage identity');
    var stats=inspect(map,true), width=12*plan.cell_size,height=12*plan.cell_size;
    var actual=image(map,root+'/'+stage.png,width,height);
    var overlay=null,ground=null;
    if(stage.mode==='alpha'){
        map.layerAt(0).visible=false;
        overlay=image(map,root+'/'+stage.overlay,width,height);
        map.layerAt(0).visible=true;map.layerAt(1).visible=false;
        ground=image(map,root+'/'+stage.ground,width,height);
        map.layerAt(1).visible=true;
        check(map.layerAt(0).visible && map.layerAt(1).visible,'Native visibility not restored after diagnostic export');
    }
    stages.push({id:stage.id,tmx:stage.tmx,actual:actual,overlay:overlay,ground:ground,stats:stats});
}
for(var context of plan.contexts){
    if(context.elapsed_ms!==0)continue;
    var map=tmx.read(root+'/'+context.map);
    check(map!==null && !map.infinite && map.width===context.width && map.height===context.height,'Native gallery/scene dimensions');
    for(var ts of map.tilesets)check(ts.fileName.length>0 && ts.fileName.indexOf(root+'/')===0,'Native external registration identity lost');
    var stats=inspect(map,true);
    check(stats.cells+stats.objects>0,'Empty actual native gallery/scene');
    check(!File.exists(root+'/'+context.export),'Refuse existing native TMJ');
    var error=jsonMap.write(map,root+'/'+context.export);check(!error,'Native TMJ export: '+error);
    var actual=image(map,root+'/'+context.png,context.width*plan.cell_size,context.height*plan.cell_size);
    contexts.push({key:context.key,map:context.map,export:context.export,actual:actual,stats:stats,tilesets:map.tilesets.map(function(ts){return ts.fileName;})});
}
for(var entry of plan.tilesets){
    var ts=tsx.read(root+'/'+entry.path);
    check(ts!==null && ts.tileCount===entry.capacity,'Native complete TSX read inventory');
    check((ts.transformationFlags&(Tileset.AllowFlipHorizontally|Tileset.AllowFlipVertically|Tileset.AllowRotate))===0,'Native directional transforms');
    check(!File.exists(root+'/'+entry.export),'Refuse existing native TSJ');
    var error=jsonTiles.write(ts,root+'/'+entry.export);check(!error,'Native TSJ export: '+error);
    tilesets.push({source:entry.path,export:entry.export,name:ts.name,tile_count:ts.tileCount,tile_width:ts.tileWidth,tile_height:ts.tileHeight});
}
check(stages.length===plan.stages.length && contexts.length===plan.contexts.filter(function(c){return c.elapsed_ms===0;}).length && tilesets.length===plan.tilesets.length,'Incomplete actual native render inventory');
writeJson(root+'/'+plan.output+'/native-render-results.json',{schema_version:1,run_token:token,consumer:plan.consumer,
          expected_inventory_sha256:plan.expected_inventory_sha256,stages:stages,contexts:contexts,tilesets:tilesets});
tiled.log('TILESET_LAB_NATIVE_PASS '+token+' native_render.js');
