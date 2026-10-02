// Emulate a browser click that was delivered but whose acknowledgement was lost.
export function loseClickResponse(page,label){
  const wrap=target=>new Proxy(target,{get(object,key){
    if(key==='getByRole')return(role,options)=>{
      const locator=wrap(object.getByRole(role,options));
      if(role!=='button'||options?.name!==label)return locator;
      return new Proxy(locator,{get(button,property){
        if(property==='click')return async(...args)=>{await button.click(...args);throw new Error('Click acknowledgement lost')};
        return Reflect.get(button,property);
      }});
    };
    const value=Reflect.get(object,key);
    return typeof value==='function'?value.bind(object):value;
  }});
  return wrap(page);
}
