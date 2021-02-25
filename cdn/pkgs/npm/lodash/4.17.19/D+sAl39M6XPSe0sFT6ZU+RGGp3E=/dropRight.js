import { default as baseSlice } from "./dist/142.js";
import { default as toInteger } from "./toInteger.js";
function dropRight(array, n, guard) {
  var length = array == null ? 0 : array.length;

  if (!length) {
    return [];
  }

  n = guard || n === undefined ? 1 : toInteger(n);
  n = length - n;
  return baseSlice(array, 0, n < 0 ? 0 : n);
}
export { dropRight as default };
/*====catalogjs annotation start====
k5KVwq0uL2Rpc3QvMTQyLmpzA8LAlcKuLi90b0ludGVnZXIuanMHwsCBp2RlZmF1bHSVoWypZHJvcFJpZ2h0D8DA3AARl6FvAAADwJDAmaFkCQACBJECwMKZoWmpYmFzZVNsaWNlkgINwACnZGVmYXVsdMDAwJihcgsJwMCRAcDCnKFpAAEBB5EEwMIAwsDAmKFnCA/AwJDAwpmhZAkABgiRBsDCmaFpqXRvSW50ZWdlcpIGDMABp2RlZmF1bHTAwMCYoXILCcDAkQXAwpyhaQEBBQmRCMDCAcLAwJihZwgQwMCQwMKXoW8BAAoOkMCZoWQAHAvAkwwNC8DCmaFsqWRyb3BSaWdodJILEMDAwMCQ2UlXbnBtL2xvZGFzaC80LjE3LjE5LzdLQTk4LW9HNjRKYzRKdFZ0Tk9qaTlwOVI0ST0vX19idWlsZF9zcmMvZHJvcFJpZ2h0LmpzmKFyCQnADJEKwMKYoXLMkAnADZEFwMKYoXIgCcDAkQHAwpihZwEDD8CQwMKYoWcJCxDAkRDAwpihcgAJwMCRCsDC
====catalogjs annotation end====*/