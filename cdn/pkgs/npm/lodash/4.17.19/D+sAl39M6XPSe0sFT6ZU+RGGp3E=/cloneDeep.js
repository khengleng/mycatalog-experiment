import { default as baseClone } from "./dist/40.js";
var CLONE_DEEP_FLAG = 1,
    CLONE_SYMBOLS_FLAG = 4;
function cloneDeep(value) {
  return baseClone(value, CLONE_DEEP_FLAG | CLONE_SYMBOLS_FLAG);
}
export { cloneDeep as default };
/*====catalogjs annotation start====
k5GVwqwuL2Rpc3QvNDAuanMDwsCBp2RlZmF1bHSVoWypY2xvbmVEZWVwEcDA3AATl6FvAAADwJDAmaFkCQACBJECwMKZoWmpYmFzZUNsb25lkgINwACnZGVmYXVsdMDAwJihcgsJwMCRAcDCnKFpAAEBBZEEwMIAwsDAmKFnCA7AwJDAwpehbwEABhCQwJihZwABBwuQwMKZoWQEBAgJkggGwMKZoWyvQ0xPTkVfREVFUF9GTEFHkggOwMDABpDZSVducG0vbG9kYXNoLzQuMTcuMTkvN0tBOTgtb0c2NEpjNEp0VnROT2ppOXA5UjRJPS9fX2J1aWxkX3NyYy9jbG9uZURlZXAuanOYoXIAD8DAkQfAwpmhZAYECsCSCgbAwpmhbLJDTE9ORV9TWU1CT0xTX0ZMQUeSCg/AwMAGkNlJV25wbS9sb2Rhc2gvNC4xNy4xOS83S0E5OC1vRzY0SmM0SnRWdE5Pamk5cDlSNEk9L19fYnVpbGRfc3JjL2Nsb25lRGVlcC5qc5ihcgASwMCRCcDCmaFkAQQMwJYNDg8MBwnAwpmhbKljbG9uZURlZXCSDBLAwMDAkNlJV25wbS9sb2Rhc2gvNC4xNy4xOS83S0E5OC1vRzY0SmM0SnRWdE5Pamk5cDlSNEk9L19fYnVpbGRfc3JjL2Nsb25lRGVlcC5qc5ihcgkJwA2RC8DCmKFyEwnADpEBwMKYoXIID8APkQfAwpihcgMSwMCRCcDCmKFnAQMRwJDAwpihZwkLEsCREsDCmKFyAAnAwJELwMI=
====catalogjs annotation end====*/