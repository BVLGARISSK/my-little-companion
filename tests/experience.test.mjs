import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_SETTINGS,PRESETS,validateSettings,validateRuntime,timerFields,runtimeLabel} from '../web-app/js/experience-format.js';

test('all presets maintain ordered sleep timings and retain zero as disabled',()=>{
 for(const preset of Object.values(PRESETS))assert.doesNotThrow(()=>validateSettings({...structuredClone(DEFAULT_SETTINGS),...preset}));
 assert.equal(PRESETS.display.off_s,0);assert.equal(PRESETS.longlife.deep_s,180);
});
test('sensor configuration rejects duplicate axes and invalid or moving gravity samples',()=>{
 for(const change of [{axis_y:0},{sign_x:0},{sensitivity:NaN},{calibrated:true,neutral:[0,0,0]},{calibrated:true,neutral:[2,0,0]}])assert.throws(()=>validateSettings({...structuredClone(DEFAULT_SETTINGS),...change}));
 assert.doesNotThrow(()=>validateSettings({...structuredClone(DEFAULT_SETTINGS),calibrated:true,neutral:[0,-1,0]}));
});
test('voltage thresholds require separation and bounded calibration offsets',()=>{
 for(const change of [{sleep_mv:3500,warn_mv:3400},{resume_mv:3420},{battery_offset_mv:301},{low_battery_enabled:'false'}])assert.throws(()=>validateSettings({...structuredClone(DEFAULT_SETTINGS),...change}));
});
test('bindings keep event order, reject absent targets and survive JSON round trip',()=>{
 const d=structuredClone(DEFAULT_SETTINGS);d.rules[3]={event:'pickup',type:'media',id:'a'.repeat(32)};
 assert.deepEqual(validateSettings(JSON.parse(JSON.stringify(d))),d);
 for(const change of [{event:'shake',type:'none',id:''},{event:'pickup',type:'media',id:'x'},{event:'pickup',type:'emotion',id:'unknown'}]){const invalid=structuredClone(d);invalid.rules[3]=change;assert.throws(()=>validateSettings(invalid));}
});
test('countdown and pomodoro fields distinguish minutes, seconds and invalid numbers',()=>{
 assert.equal(timerFields({minutes:1}).duration_s,60);
 assert.equal(timerFields({mode:'pomodoro',minutes:0,focus:25}).duration_s,1500);
 for(const change of [{minutes:0},{minutes:1441},{focus:NaN},{rest:Infinity},{rounds:1.5}])assert.throws(()=>timerFields(change));
});
test('runtime labels distinguish stopped, paused, locked and critical states',()=>{
 assert.match(runtimeLabel(null),/連線/);
 assert.match(runtimeLabel({touch_locked:true,tool:2,timer:{active:true,paused:true,remaining_s:10}}),/鎖定.*暫停 10 秒/);
 assert.match(runtimeLabel({tool:0,critical_battery:true,timer:{finished:true}}),/計時完成.*低電壓/);
});
test('runtime rejects impossible timers, nonfinite tilt and malformed state without modifying input',()=>{
 const valid={touch_locked:false,calibration_needed:true,settings_recovered:false,upside_down:false,low_battery:false,critical_battery:false,clock_valid:false,epoch_ms:0,offset_min:480,tool:0,tilt_x:0,tilt_y:0,events_fired:0,timer:{active:false,paused:false,finished:false,pomodoro:false,phase:0,round:1,rounds:4,remaining_s:0}};
 assert.deepEqual(validateRuntime(valid),valid);assert.notEqual(validateRuntime(valid),valid);
 for(const invalid of [{...valid,tilt_x:NaN},{...valid,tool:6},{...valid,timer:{...valid.timer,paused:true}},{...valid,timer:{...valid.timer,active:true,finished:true}},{...valid,timer:{...valid.timer,remaining_s:86401}}])assert.throws(()=>validateRuntime(invalid));
});
