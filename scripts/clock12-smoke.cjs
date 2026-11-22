/* The 12-hour time picker (supplier reminders, Rico's Scheduled tasks): what it shows and the 24-hour
   "HH:MM" it hands the server. Erbil reads the 12-hour clock, so the picker shows 1 to 12 and AM/PM in
   each language's words, while the saved value stays 24-hour. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const from = src.indexOf('const DAY_PERIOD_WORDS'), to = src.indexOf('function setTimePicker');
assert.ok(from > 0 && to > from, 'the picker helpers are in app.js');
const state = {lang:'en'};
const esc = s=>String(s), t = k=>k;
const load = new Function('state', 'esc', 't', src.slice(from, to) + '; return {timePickerHtml, timePickerValue};');
const {timePickerHtml, timePickerValue} = load(state, esc, t);

const picked = (html, k)=>((html.match(new RegExp(`data-t12="${k}"[\\s\\S]*?</select>`)) || [''])[0].match(/value="([^"]+)" selected/) || [])[1];
const fake = v=>({querySelector:q=>({value:v[q.match(/"(\w)"/)[1]]})});

for(const [stored, h, m, p] of [['00:00', '12', '0', 'am'], ['09:00', '9', '0', 'am'], ['12:30', '12', '30', 'pm'], ['13:05', '1', '5', 'pm'], ['23:55', '11', '55', 'pm'], ['07:33', '7', '33', 'am']]){
  const html = timePickerHtml('x', stored, 'Time');
  assert.deepEqual([picked(html, 'h'), picked(html, 'm'), picked(html, 'p')], [h, m, p], `${stored} shows as ${h}:${m} ${p}`);
  assert.equal(timePickerValue(fake({h, m, p})), stored, `${h}:${m} ${p} is saved as ${stored}`);
}
assert.ok(!/<option value="(0|1[3-9]|2\d)"[^>]*>\1</.test(timePickerHtml('x', '15:00', 'Time').split('data-t12="m"')[0]), 'the hour box only offers 1 to 12');
assert.match(timePickerHtml('x', '15:00', 'Time'), />AM<.*>PM</s, 'English says AM and PM');
state.lang = 'ku'; assert.match(timePickerHtml('x', '15:00', 'Time'), /پ\.ن.*د\.ن/s, 'Kurdish uses its AM/PM words');
state.lang = 'ar'; assert.match(timePickerHtml('x', '15:00', 'Time'), />ص<.*>م</s, 'Arabic uses its AM/PM words');
assert.match(timePickerHtml('x', '15:00', 'Time'), /dir="ltr"/, 'it reads 3:30 PM left to right in every language');
assert.equal(timePickerValue(null), '', 'no picker, no time');

for(const f of ['app.js', 'rico-plus.js']) assert.ok(!/type="(time|datetime-local)"/.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')), `${f} has no 24-hour time box left`);
console.log('12-hour clock smoke: PASS (1 to 12 with AM/PM in English, Kurdish and Arabic; saved as 24-hour HH:MM; no browser time boxes left)');
