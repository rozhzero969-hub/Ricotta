// Signing in to the workplace site with the PIN keypad, only when the site shows its sign-in page.
// The PIN comes from WORKPLACE_PIN in worker/.env and is never logged, stored or sent anywhere.
// Each digit is a press on the page's own keypad (no typing into hidden fields, no coordinate clicks).
export const LOGIN_PATH = /\/login\/?$/;

export async function onLoginPage(page){
  let path = '';
  try{ path = new URL(page.url()).pathname; }catch{}
  if(LOGIN_PATH.test(path)) return true;
  return await page.getByRole('heading', {name: /^Sign in$/i}).isVisible().catch(() => false)
    && await page.getByText(/Enter your PIN/i).first().isVisible().catch(() => false);
}

const exactlyOne = async (locator, label) => {
  await locator.first().waitFor({state: 'visible', timeout: 10000}).catch(() => {});
  const n = await locator.count();
  if(n !== 1) throw new Error(`Sign-in page: expected one ${label}, found ${n}`);
  return locator;
};

/* Returns when the site has left the sign-in page. Throws (without retrying) if anything is unexpected. */
export async function signIn(page, pin, {timeout = 20000} = {}){
  if(!/^\d{4,8}$/.test(String(pin || ''))) throw new Error('WORKPLACE_PIN is not set in worker/.env, so the PC cannot sign in by itself');
  if(!await onLoginPage(page)) return false;
  await (await exactlyOne(page.getByRole('heading', {name: /^Sign in$/i}), 'Sign in heading'));
  // The PIN tab (a button or a tab, depending on how the page draws it).
  const pinTab = page.getByRole('button', {name: 'PIN', exact: true}).or(page.getByRole('tab', {name: 'PIN', exact: true}));
  await (await exactlyOne(pinTab, 'PIN tab')).click();
  await (await exactlyOne(page.getByText(/Enter your PIN/i), 'PIN prompt'));
  const clear = page.getByRole('button', {name: 'Clear', exact: true});
  if(await clear.count() === 1) await clear.click();
  for(const digit of String(pin)){
    await (await exactlyOne(page.getByRole('button', {name: digit, exact: true}), 'keypad key')).click();   // the digit itself is never put in a message
    await page.waitForTimeout(120);
  }
  // Most PIN pages sign in on the last digit; a separate Sign in button is pressed only if one is showing.
  const left = () => page.waitForURL(u => !LOGIN_PATH.test(new URL(u).pathname), {timeout}).then(() => true, () => false);
  if(!await left()){
    const submit = page.getByRole('button', {name: /^(sign in|log in|login|continue)$/i});
    if(await submit.count() === 1 && await submit.isEnabled()){ await submit.click(); await left(); }
  }
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  if(await onLoginPage(page)) throw new Error('Still on the sign-in page after entering the PIN. The PIN may be wrong or the page may have changed');
  return true;
}
