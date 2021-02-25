import { default as hasPath } from "./dist/15.js";
var objectProto = Object.prototype;
var hasOwnProperty0 = objectProto.hasOwnProperty;
function baseHas(object, key) {
  return object != null && hasOwnProperty0.call(object, key);
}
function has(object, path) {
  return object != null && hasPath(object, path, baseHas);
}
export { has as default };
/*====catalogjs annotation start====
k5GVwqwuL2Rpc3QvMTUuanMDwsCBp2RlZmF1bHSVoWyjaGFzFsDA3AAYl6FvAAADwJDAmaFkCQACBJECwMKZoWmnaGFzUGF0aJICE8AAp2RlZmF1bHTAwMCYoXILB8DAkQHAwpyhaQABAQWRBMDCAMLAwJihZwgOwMCQwMKXoW8BAAYQkMCYoWcAAQcJkMDCmaFkBBMIwJIIBsDCmaFsq29iamVjdFByb3RvkggMwMDABpDZSFducG0vbG9kYXNoLzQuMTcuMTkvN0tBOTgtb0c2NEpjNEp0VnROT2ppOXA5UjRJPS9fX2J1aWxkX3NyYy9fYmFzZUhhcy5qc5ihcgALwMCRB8DCmKFnAQEKDZDAwpmhZAQPC8CUDAsJB8DCmaFsr2hhc093blByb3BlcnR5MJILD8DAwAmQ2UhXbnBtL2xvZGFzaC80LjE3LjE5LzdLQTk4LW9HNjRKYzRKdFZ0Tk9qaTlwOVI0ST0vX19idWlsZF9zcmMvX2Jhc2VIYXMuanOYoXIAD8AMkQrAwpihcgMLwMCRB8DCmaFkARUOwJMPDgrAwpmhbKdiYXNlSGFzkg4UwMDAwJDZSFducG0vbG9kYXNoLzQuMTcuMTkvN0tBOTgtb0c2NEpjNEp0VnROT2ppOXA5UjRJPS9fX2J1aWxkX3NyYy9fYmFzZUhhcy5qc5ihcgkHwA+RDcDCmKFyKw/AwJEKwMKXoW8BABEVkMCZoWQABBLAkxMUEsDCmaFso2hhc5ISF8DAwMCQ2UNXbnBtL2xvZGFzaC80LjE3LjE5LzdLQTk4LW9HNjRKYzRKdFZ0Tk9qaTlwOVI0ST0vX19idWlsZF9zcmMvaGFzLmpzmKFyCQPAE5ERwMKYoXIsB8AUkQHAwpihcg8HwMCRDcDCmKFnAQMWwJDAwpihZwkLF8CRF8DCmKFyAAPAwJERwMI=
====catalogjs annotation end====*/