import { default as getTag } from "./dist/45.js";
import { default as isObjectLike } from "./isObjectLike.js";
import { default as baseUnary } from "./dist/135.js";
import { default as nodeUtil } from "./dist/94.js";
var mapTag = '[object Map]';
function baseIsMap(value) {
  return isObjectLike(value) && getTag(value) == mapTag;
}
var nodeIsMap = nodeUtil && nodeUtil.isMap;
var isMap = nodeIsMap ? baseUnary(nodeIsMap) : baseIsMap;
export { isMap as default };
/*====catalogjs annotation start====
k5SVwqwuL2Rpc3QvNDUuanMDwsCVwrEuL2lzT2JqZWN0TGlrZS5qcwbCwJXCrS4vZGlzdC8xMzUuanMJwsCVwqwuL2Rpc3QvOTQuanMMwsCBp2RlZmF1bHSVoWylaXNNYXAlwMDcACeXoW8AAAPAkR3AmaFkCQACwJECwMKZoWmmZ2V0VGFnkgIUwACnZGVmYXVsdMDAwJihcgsGwMCRAcDCnKFpABcBBpDAwgDCwMCZoWQJAAXAkQXAwpmhaaxpc09iamVjdExpa2WSBRPAAadkZWZhdWx0wMDAmKFyCwzAwJEEwMKcoWkBHAQJkMDCAcLAwJmhZAkACMCRCMDCmaFpqWJhc2VVbmFyeZIIIcACp2RlZmF1bHTAwMCYoXILCcDAkQfAwpyhaQEYBwyQwMICwsDAmaFkCQALwJELwMKZoWmobm9kZVV0aWyTCxobwAOnZGVmYXVsdMDAwJihcgsIwMCRCsDCnKFpARcKDZDAwgPCwMCXoW8BAA4WkMCYoWcAAQ8RkMDCmaFkBBEQwJIQDsDCmaFspm1hcFRhZ5IQFcDAwA6Q2UpXbnBtL2xvZGFzaC80LjE3LjE5LzdLQTk4LW9HNjRKYzRKdFZ0Tk9qaTlwOVI0ST0vX19idWlsZF9zcmMvX2Jhc2VJc01hcC5qc5ihcgAGwMCRD8DCmaFkAQMSwJUTFBUSD8DCmaFsqWJhc2VJc01hcJISI8DAwMCQ2UpXbnBtL2xvZGFzaC80LjE3LjE5LzdLQTk4LW9HNjRKYzRKdFZ0Tk9qaTlwOVI0ST0vX19idWlsZF9zcmMvX2Jhc2VJc01hcC5qc5ihcgkJwBOREcDCmKFyEwzAFJEEwMKYoXILBsAVkQHAwpihcgsGwMCRD8DCl6FvAQAXJJDAmKFnAAEYHJDAwpmhZAQGGcCUGhsZF8DCmaFsqW5vZGVJc01hcJMZICLAwMAXkNlFV25wbS9sb2Rhc2gvNC4xNy4xOS83S0E5OC1vRzY0SmM0SnRWdE5Pamk5cDlSNEk9L19fYnVpbGRfc3JjL2lzTWFwLmpzmKFyAAnAGpEYwMKYoXIDCMAbkQrAwpihcgQIwMCRCsDCmKFnAQEdwJDAwpmhZAQAHsCUHhwfGMDCmaFspWlzTWFwkh4mwMDAHJDZRVducG0vbG9kYXNoLzQuMTcuMTkvN0tBOTgtb0c2NEpjNEp0VnROT2ppOXA5UjRJPS9fX2J1aWxkX3NyYy9pc01hcC5qc5ihcgAFwB+RHcDCmKFnAwAgwJQgISIjwMKYoXIACcAhkRjAwpihcgMJwCKRB8DCmKFyAQnAI5EYwMKYoXIECcDAkRHAwpihZwEDJcCQwMKYoWcJCybAkSbAwpihcgAFwMCRHcDC
====catalogjs annotation end====*/