import { default as getTag } from "./dist/45.js";
import { default as isObjectLike } from "./isObjectLike.js";
var weakMapTag = '[object WeakMap]';
function isWeakMap(value) {
  return isObjectLike(value) && getTag(value) == weakMapTag;
}
export { isWeakMap as default };
/*====catalogjs annotation start====
k5KVwqwuL2Rpc3QvNDUuanMDwsCVwrEuL2lzT2JqZWN0TGlrZS5qcwfCwIGnZGVmYXVsdJWhbKlpc1dlYWtNYXATwMDcABWXoW8AAAPAkMCZoWQJAAIEkQLAwpmhaaZnZXRUYWeSAhDAAKdkZWZhdWx0wMDAmKFyCwbAwJEBwMKcoWkAAQEHkQTAwgDCwMCYoWcIDsDAkMDCmaFkCQAGCJEGwMKZoWmsaXNPYmplY3RMaWtlkgYPwAGnZGVmYXVsdMDAwJihcgsMwMCRBcDCnKFpAQEFCZEIwMIBwsDAmKFnCBPAwJDAwpehbwEAChKQwJihZwABCw2QwMKZoWQEFQzAkgwKwMKZoWyqd2Vha01hcFRhZ5IMEcDAwAqQ2UlXbnBtL2xvZGFzaC80LjE3LjE5LzdLQTk4LW9HNjRKYzRKdFZ0Tk9qaTlwOVI0ST0vX19idWlsZF9zcmMvaXNXZWFrTWFwLmpzmKFyAArAwJELwMKZoWQBAw7AlQ8QEQ4LwMKZoWypaXNXZWFrTWFwkg4UwMDAwJDZSVducG0vbG9kYXNoLzQuMTcuMTkvN0tBOTgtb0c2NEpjNEp0VnROT2ppOXA5UjRJPS9fX2J1aWxkX3NyYy9pc1dlYWtNYXAuanOYoXIJCcAPkQ3AwpihchMMwBCRBcDCmKFyCwbAEZEBwMKYoXILCsDAkQvAwpihZwEDE8CQwMKYoWcJCxTAkRTAwpihcgAJwMCRDcDC
====catalogjs annotation end====*/