/* One 12-hour field preserves the exact Baghdad wall-clock value sent to the scheduler. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const read = name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const src = read('app.js'), rico = read('rico-plus.js');
const helpers = src.slice(src.indexOf('function splitClock'), src.indexOf('/* While something loads'));
const parser = rico.slice(rico.indexOf('function scheduleClock'),rico.indexOf('/* A prepared order'));
const {timePickerHtml, timePickerValue, setTimePicker} =
  new Function('esc',helpers+parser+';return {timePickerHtml,timePickerValue,setTimePicker}')(String);
for(const [value, shown] of Object.entries({'00:00':'12:00 AM','09:00':'9:00 AM','12:30':'12:30 PM','13:05':'1:05 PM','23:55':'11:55 PM','07:33':'7:33 AM'})){
  const html = timePickerHtml('x',value,'Baghdad time');
  assert.ok(html.includes('value="'+shown+'"'));
  assert.equal((html.match(/<input/g)||[]).length,1);
  const field = {}; setTimePicker(field,value);
  assert.equal(timePickerValue(field),value);
}
assert.equal(timePickerValue({value:'11'}),'');
assert.equal(timePickerValue({value:'١١:٣٧ د.ن'}),'23:37');
assert.equal(timePickerValue(null),'');
console.log('Supplier clock PASS: one 12-hour input stores Baghdad wall-clock time.');
