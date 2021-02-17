import { default as createPadding } from "./dist/21.js";
import { default as stringSize } from "./dist/144.js";
import { default as toInteger } from "./toInteger.js";
import { default as toString0 } from "./toString.js";
var nativeCeil = Math.ceil,
    nativeFloor = Math.floor;
function pad(string, length, chars) {
  string = toString0(string);
  length = toInteger(length);
  var strLength = length ? stringSize(string) : 0;

  if (!length || strLength >= length) {
    return string;
  }

  var mid = (length - strLength) / 2;
  return createPadding(nativeFloor(mid), chars) + string + createPadding(nativeCeil(mid), chars);
}
export { pad as default };
/*====catalogjs annotation start====
k5SVwqwuL2Rpc3QvMjEuanMDwsCVwq0uL2Rpc3QvMTQ0LmpzB8LAlcKuLi90b0ludGVnZXIuanMLwsCVwq0uL3RvU3RyaW5nLmpzD8LAgadkZWZhdWx0laFso3BhZCHAwNwAI5ehbwAAA8CQwJmhZAkAAgSRAsDCmaFprWNyZWF0ZVBhZGRpbmeTAhwewACnZGVmYXVsdMDAwJihcgsNwMCRAcDCnKFpAAEBB5EEwMIAwsDAmKFnCA7AwJDAwpmhZAkABgiRBsDCmaFpqnN0cmluZ1NpemWSBhvAAadkZWZhdWx0wMDAmKFyCwrAwJEFwMKcoWkBAQULkQjAwgHCwMCYoWcID8DAkMDCmaFkCQAKDJEKwMKZoWmpdG9JbnRlZ2VykgoawAKnZGVmYXVsdMDAwJihcgsJwMCRCcDCnKFpAQEJD5EMwMICwsDAmKFnCBDAwJDAwpmhZAkADhCRDsDCmaFpqXRvU3RyaW5nMJIOGcADp2RlZmF1bHTAwMCYoXILCcDAkQ3AwpyhaQEBDRGREMDCA8LAwJihZwgPwMCQwMKXoW8BABIgkMCYoWcAARMXkMDCmaFkBAwUFZIUEsDCmaFsqm5hdGl2ZUNlaWySFB/AwMASkNlDV25wbS9sb2Rhc2gvNC4xNy4xOS83S0E5OC1vRzY0SmM0SnRWdE5Pamk5cDlSNEk9L19fYnVpbGRfc3JjL3BhZC5qc5ihcgAKwMCRE8DCmaFkBg0WwJIWEsDCmaFsq25hdGl2ZUZsb29ykhYdwMDAEpDZQ1ducG0vbG9kYXNoLzQuMTcuMTkvN0tBOTgtb0c2NEpjNEp0VnROT2ppOXA5UjRJPS9fX2J1aWxkX3NyYy9wYWQuanOYoXIAC8DAkRXAwpmhZAEQGMCaGRobHB0eHxgVE8DCmaFso3BhZJIYIsDAwMCQ2UNXbnBtL2xvZGFzaC80LjE3LjE5LzdLQTk4LW9HNjRKYzRKdFZ0Tk9qaTlwOVI0ST0vX19idWlsZF9zcmMvcGFkLmpzmKFyCQPAGZEXwMKYoXIlCcAakQ3AwpihchUJwBuRCcDCmKFyJQrAHJEFwMKYoXJ+DcAdkQHAwpihcgELwB6RFcDCmKFyGQ3AH5EBwMKYoXIBCsDAkRPAwpihZwEDIcCQwMKYoWcJCyLAkSLAwpihcgADwMCRF8DC
====catalogjs annotation end====*/