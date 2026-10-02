// Read back numeric inputs without silently dropping a minus sign or unexpected text.
export function readNumber(value){
  const text=String(value??'').trim();
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text))return NaN;
  const number=Number(text.replaceAll(',',''));
  return Number.isFinite(number)?number:NaN;
}
export function sameNumber(actual,expected){
  const number=readNumber(actual);
  return Number.isFinite(number)&&typeof expected==='number'&&Number.isFinite(expected)&&number===expected;
}
