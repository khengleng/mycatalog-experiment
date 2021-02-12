import { default as getTag } from "./dist/45.js";
import { default as isObjectLike } from "./isObjectLike.js";
import { default as baseUnary } from "./dist/135.js";
import { default as nodeUtil } from "./dist/94.js";
var setTag = '[object Set]';
function baseIsSet(value) {
  return isObjectLike(value) && getTag(value) == setTag;
}
var nodeIsSet = nodeUtil && nodeUtil.isSet;
var isSet = nodeIsSet ? baseUnary(nodeIsSet) : baseIsSet;
export { isSet as default };
/*====catalogjs annotation start====
k5SVwqwuL2Rpc3QvNDUuanMDwsCVwrEuL2lzT2JqZWN0TGlrZS5qcwbCwJXCrS4vZGlzdC8xMzUuanMJwsCVwqwuL2Rpc3QvOTQuanMMwsCBp2RlZmF1bHSVoWylaXNTZXQlwMDcACeXoW8AAAPAkR3AmaFkCQACwJECwMKZoWmmZ2V0VGFnkgIUwACnZGVmYXVsdMDAwJihcgsGwMCRAcDCnKFpABcBBpDAwgDCwMCZoWQJAAXAkQXAwpmhaaxpc09iamVjdExpa2WSBRPAAadkZWZhdWx0wMDAmKFyCwzAwJEEwMKcoWkBHAQJkMDCAcLAwJmhZAkACMCRCMDCmaFpqWJhc2VVbmFyeZIIIcACp2RlZmF1bHTAwMCYoXILCcDAkQfAwpyhaQEYBwyQwMICwsDAmaFkCQALwJELwMKZoWmobm9kZVV0aWyTCxobwAOnZGVmYXVsdMDAwJihcgsIwMCRCsDCnKFpARcKDZDAwgPCwMCXoW8BAA4WkMCYoWcAAQ8RkMDCmaFkBBEQwJIQDsDCmaFspnNldFRhZ5IQFcDAwA6Q2UpXbnBtL2xvZGFzaC80LjE3LjE5LzdLQTk4LW9HNjRKYzRKdFZ0Tk9qaTlwOVI0ST0vX19idWlsZF9zcmMvX2Jhc2VJc1NldC5qc5ihcgAGwMCRD8DCmaFkAQMSwJUTFBUSD8DCmaFsqWJhc2VJc1NldJISI8DAwMCQ2UpXbnBtL2xvZGFzaC80LjE3LjE5LzdLQTk4LW9HNjRKYzRKdFZ0Tk9qaTlwOVI0ST0vX19idWlsZF9zcmMvX2Jhc2VJc1NldC5qc5ihcgkJwBOREcDCmKFyEwzAFJEEwMKYoXILBsAVkQHAwpihcgsGwMCRD8DCl6FvAQAXJJDAmKFnAAEYHJDAwpmhZAQGGcCUGhsZF8DCmaFsqW5vZGVJc1NldJMZICLAwMAXkNlFV25wbS9sb2Rhc2gvNC4xNy4xOS83S0E5OC1vRzY0SmM0SnRWdE5Pamk5cDlSNEk9L19fYnVpbGRfc3JjL2lzU2V0LmpzmKFyAAnAGpEYwMKYoXIDCMAbkQrAwpihcgQIwMCRCsDCmKFnAQEdwJDAwpmhZAQAHsCUHhwfGMDCmaFspWlzU2V0kh4mwMDAHJDZRVducG0vbG9kYXNoLzQuMTcuMTkvN0tBOTgtb0c2NEpjNEp0VnROT2ppOXA5UjRJPS9fX2J1aWxkX3NyYy9pc1NldC5qc5ihcgAFwB+RHcDCmKFnAwAgwJQgISIjwMKYoXIACcAhkRjAwpihcgMJwCKRB8DCmKFyAQnAI5EYwMKYoXIECcDAkRHAwpihZwEDJcCQwMKYoWcJCybAkSbAwpihcgAFwMCRHcDC
====catalogjs annotation end====*/