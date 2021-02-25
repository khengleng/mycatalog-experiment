import { default as baseGetTag } from "./dist/86.js";
import { default as isObjectLike } from "./isObjectLike.js";
import { default as baseUnary } from "./dist/135.js";
import { default as nodeUtil } from "./dist/94.js";
var regexpTag = '[object RegExp]';
function baseIsRegExp(value) {
  return isObjectLike(value) && baseGetTag(value) == regexpTag;
}
var nodeIsRegExp = nodeUtil && nodeUtil.isRegExp;
var isRegExp = nodeIsRegExp ? baseUnary(nodeIsRegExp) : baseIsRegExp;
export { isRegExp as default };
/*====catalogjs annotation start====
k5SVwqwuL2Rpc3QvODYuanMDwsCVwrEuL2lzT2JqZWN0TGlrZS5qcwfCwJXCrS4vZGlzdC8xMzUuanMLwsCVwqwuL2Rpc3QvOTQuanMPwsCBp2RlZmF1bHSVoWyoaXNSZWdFeHApwMDcACuXoW8AAAPAkSHAmaFkCQACBJECwMKZoWmqYmFzZUdldFRhZ5ICGMAAp2RlZmF1bHTAwMCYoXILCsDAkQHAwpyhaQABAQeRBMDCAMLAwJihZwgOwMCQwMKZoWQJAAYIkQbAwpmhaaxpc09iamVjdExpa2WSBhfAAadkZWZhdWx0wMDAmKFyCwzAwJEFwMKcoWkBAQULkQjAwgHCwMCYoWcIE8DAkMDCmaFkCQAKDJEKwMKZoWmpYmFzZVVuYXJ5kgolwAKnZGVmYXVsdMDAwJihcgsJwMCRCcDCnKFpAQEJD5EMwMICwsDAmKFnCA/AwJDAwpmhZAkADhCRDsDCmaFpqG5vZGVVdGlskw4eH8ADp2RlZmF1bHTAwMCYoXILCMDAkQ3AwpyhaQEBDRGREMDCA8LAwJihZwgOwMCQwMKXoW8BABIakMCYoWcAARMVkMDCmaFkBBQUwJIUEsDCmaFsqXJlZ2V4cFRhZ5IUGcDAwBKQ2U1XbnBtL2xvZGFzaC80LjE3LjE5LzdLQTk4LW9HNjRKYzRKdFZ0Tk9qaTlwOVI0ST0vX19idWlsZF9zcmMvX2Jhc2VJc1JlZ0V4cC5qc5ihcgAJwMCRE8DCmaFkAQMWwJUXGBkWE8DCmaFsrGJhc2VJc1JlZ0V4cJIWJ8DAwMCQ2U1XbnBtL2xvZGFzaC80LjE3LjE5LzdLQTk4LW9HNjRKYzRKdFZ0Tk9qaTlwOVI0ST0vX19idWlsZF9zcmMvX2Jhc2VJc1JlZ0V4cC5qc5ihcgkMwBeRFcDCmKFyEwzAGJEFwMKYoXILCsAZkQHAwpihcgsJwMCRE8DCl6FvAQAbKJDAmKFnAAEcIJDAwpmhZAQJHcCUHh8dG8DCmaFsrG5vZGVJc1JlZ0V4cJMdJCbAwMAbkNlIV25wbS9sb2Rhc2gvNC4xNy4xOS83S0E5OC1vRzY0SmM0SnRWdE5Pamk5cDlSNEk9L19fYnVpbGRfc3JjL2lzUmVnRXhwLmpzmKFyAAzAHpEcwMKYoXIDCMAfkQ3AwpihcgQIwMCRDcDCmKFnAQEhwJDAwpmhZAQAIsCUIiAjHMDCmaFsqGlzUmVnRXhwkiIqwMDAIJDZSFducG0vbG9kYXNoLzQuMTcuMTkvN0tBOTgtb0c2NEpjNEp0VnROT2ppOXA5UjRJPS9fX2J1aWxkX3NyYy9pc1JlZ0V4cC5qc5ihcgAIwCORIcDCmKFnAwAkwJQkJSYnwMKYoXIADMAlkRzAwpihcgMJwCaRCcDCmKFyAQzAJ5EcwMKYoXIEDMDAkRXAwpihZwEDKcCQwMKYoWcJCyrAkSrAwpihcgAIwMCRIcDC
====catalogjs annotation end====*/