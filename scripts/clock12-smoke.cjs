/* The supplier's one native field still sends an exact Baghdad HH:MM value. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const src = fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
const helpers = src.slice(src.indexOf('function timePickerHtml'), src.indexOf('/* While something loads'));
const {timePickerHtml, timePickerValue, setTimePicker} = new Function('esc',helpers+';return {timePickerHtml,timePickerValue,setTimePicker}')(String);
for(const value of ['00:00','09:00','12:30','13:05','23:55','07:33']){
  const html = timePickerHtml('x',value,'Erbil time');
  assert.match(html,new RegExp('type="time".*value="'+value+'"'));
  assert.equal((html.match(/<input/g)||[]).length,1);
  const field = {}; setTimePicker(field,value);
  assert.equal(timePickerValue(field),value);
}
assert.equal(timePickerValue(null),'');
console.log('Supplier clock PASS: a single field preserves exact minutes and midnight.');
