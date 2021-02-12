var arrayProto = Array.prototype;
var nativeJoin = arrayProto.join;
function join(array, separator) {
  return array == null ? '' : nativeJoin.call(array, separator);
}
export { join as default };
/*====catalogjs annotation start====
k5CBp2RlZmF1bHSVoWykam9pbg3AwJ+XoW8AAAHAkMCXoW8AAAIMkMCYoWcAAQMFkMDCmaFkBBIEwJIEAsDCmaFsqmFycmF5UHJvdG+SBAjAwMACkNlEV25wbS9sb2Rhc2gvNC4xNy4xOS83S0E5OC1vRzY0SmM0SnRWdE5Pamk5cDlSNEk9L19fYnVpbGRfc3JjL2pvaW4uanOYoXIACsDAkQPAwpihZwEBBgmQwMKZoWQEBQfAlAgHBQPAwpmhbKpuYXRpdmVKb2lukgcLwMDABZDZRFducG0vbG9kYXNoLzQuMTcuMTkvN0tBOTgtb0c2NEpjNEp0VnROT2ppOXA5UjRJPS9fX2J1aWxkX3NyYy9qb2luLmpzmKFyAArACJEGwMKYoXIDCsDAkQPAwpmhZAEaCsCTCwoGwMKZoWykam9pbpIKDsDAwMCQ2URXbnBtL2xvZGFzaC80LjE3LjE5LzdLQTk4LW9HNjRKYzRKdFZ0Tk9qaTlwOVI0ST0vX19idWlsZF9zcmMvam9pbi5qc5ihcgkEwAuRCcDCmKFyMwrAwJEGwMKYoWcBAw3AkMDCmKFnCQsOwJEOwMKYoXIABMDAkQnAwg==
====catalogjs annotation end====*/