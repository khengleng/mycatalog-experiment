import { default as hasUnicode } from "./145.js";
function asciiToArray(string) {
  return string.split('');
}
var rsAstralRange = '\\ud800-\\udfff',
    rsComboMarksRange = '\\u0300-\\u036f',
    reComboHalfMarksRange = '\\ufe20-\\ufe2f',
    rsComboSymbolsRange = '\\u20d0-\\u20ff',
    rsComboRange = rsComboMarksRange + reComboHalfMarksRange + rsComboSymbolsRange,
    rsVarRange = '\\ufe0e\\ufe0f';
var rsAstral = '[' + rsAstralRange + ']',
    rsCombo = '[' + rsComboRange + ']',
    rsFitz = '\\ud83c[\\udffb-\\udfff]',
    rsModifier = '(?:' + rsCombo + '|' + rsFitz + ')',
    rsNonAstral = '[^' + rsAstralRange + ']',
    rsRegional = '(?:\\ud83c[\\udde6-\\uddff]){2}',
    rsSurrPair = '[\\ud800-\\udbff][\\udc00-\\udfff]',
    rsZWJ = '\\u200d';
var reOptMod = rsModifier + '?',
    rsOptVar = '[' + rsVarRange + ']?',
    rsOptJoin = '(?:' + rsZWJ + '(?:' + [rsNonAstral, rsRegional, rsSurrPair].join('|') + ')' + rsOptVar + reOptMod + ')*',
    rsSeq = rsOptVar + reOptMod + rsOptJoin,
    rsSymbol = '(?:' + [rsNonAstral + rsCombo + '?', rsCombo, rsRegional, rsSurrPair, rsAstral].join('|') + ')';
var reUnicode = RegExp(rsFitz + '(?=' + rsFitz + ')|' + rsSymbol + rsSeq, 'g');
function unicodeToArray(string) {
  return string.match(reUnicode) || [];
}
function stringToArray(string) {
  return hasUnicode(string) ? unicodeToArray(string) : asciiToArray(string);
}
export { stringToArray as default };
/*====catalogjs annotation start====
k5GVwqguLzE0NS5qcwPCwIGnZGVmYXVsdJWhbK1zdHJpbmdUb0FycmF5X8DA3ABhl6FvAAADwJM2RE7AmaFkCQACBJECwMKZoWmqaGFzVW5pY29kZZICW8AAp2RlZmF1bHTAwMCYoXILCsDAkQHAwpyhaQABAQWRBMDCAMLAwJihZwgKwMCQwMKXoW8BAAYIkMCZoWQAJwfAkQfAwpmhbKxhc2NpaVRvQXJyYXmSB13AwMDAkNlNV25wbS9sb2Rhc2gvNC4xNy4xOS83S0E5OC1vRzY0SmM0SnRWdE5Pamk5cDlSNEk9L19fYnVpbGRfc3JjL19hc2NpaVRvQXJyYXkuanOYoXIJDMDAkQbAwpehbwEACViQwJihZwABChmQwMKZoWQEFAsMkgsJwMKZoWytcnNBc3RyYWxSYW5nZZMLHCjAwMAJkNlPV25wbS9sb2Rhc2gvNC4xNy4xOS83S0E5OC1vRzY0SmM0SnRWdE5Pamk5cDlSNEk9L19fYnVpbGRfc3JjL191bmljb2RlVG9BcnJheS5qc5ihcgANwMCRCsDCmaFkBhQNDpINCcDCmaFssXJzQ29tYm9NYXJrc1Jhbmdlkg0UwMDACZDZT1ducG0vbG9kYXNoLzQuMTcuMTkvN0tBOTgtb0c2NEpjNEp0VnROT2ppOXA5UjRJPS9fX2J1aWxkX3NyYy9fdW5pY29kZVRvQXJyYXkuanOYoXIAEcDAkQzAwpmhZAYUDxCSDwnAwpmhbLVyZUNvbWJvSGFsZk1hcmtzUmFuZ2WSDxXAwMAJkNlPV25wbS9sb2Rhc2gvNC4xNy4xOS83S0E5OC1vRzY0SmM0SnRWdE5Pamk5cDlSNEk9L19fYnVpbGRfc3JjL191bmljb2RlVG9BcnJheS5qc5ihcgAVwMCRDsDCmaFkBhQREpIRCcDCmaFss3JzQ29tYm9TeW1ib2xzUmFuZ2WSERbAwMAJkNlPV25wbS9sb2Rhc2gvNC4xNy4xOS83S0E5OC1vRzY0SmM0SnRWdE5Pamk5cDlSNEk9L19fYnVpbGRfc3JjL191bmljb2RlVG9BcnJheS5qc5ihcgATwMCREMDCmaFkBgATF5gUFRYTCQwOEMDCmaFsrHJzQ29tYm9SYW5nZZITH8DAwAmQ2U9XbnBtL2xvZGFzaC80LjE3LjE5LzdLQTk4LW9HNjRKYzRKdFZ0Tk9qaTlwOVI0ST0vX19idWlsZF9zcmMvX3VuaWNvZGVUb0FycmF5LmpzmKFyAAzAFJESwMKYoXIDEcAVkQzAwpihcgMVwBaRDsDCmKFyAxPAwJEQwMKZoWQGExjAkhgJwMKZoWyqcnNWYXJSYW5nZZIYNcDAwAmQ2U9XbnBtL2xvZGFzaC80LjE3LjE5LzdLQTk4LW9HNjRKYzRKdFZ0Tk9qaTlwOVI0ST0vX19idWlsZF9zcmMvX3VuaWNvZGVUb0FycmF5LmpzmKFyAArAwJEXwMKYoWcBARovkMDCmaFkBAYbHZQcGxkKwMKZoWyocnNBc3RyYWySG0zAwMAZkNlPV25wbS9sb2Rhc2gvNC4xNy4xOS83S0E5OC1vRzY0SmM0SnRWdE5Pamk5cDlSNEk9L19fYnVpbGRfc3JjL191bmljb2RlVG9BcnJheS5qc5ihcgAIwByRGsDCmKFyCQ3AwJEKwMKZoWQGBh4glB8eGRLAwpmhbKdyc0NvbWJvlB4kSEnAwMAZkNlPV25wbS9sb2Rhc2gvNC4xNy4xOS83S0E5OC1vRzY0SmM0SnRWdE5Pamk5cDlSNEk9L19fYnVpbGRfc3JjL191bmljb2RlVG9BcnJheS5qc5ihcgAHwB+RHcDCmKFyCQzAwJESwMKZoWQGHSEikiEZwMKZoWymcnNGaXR6lCElUVLAwMAZkNlPV25wbS9sb2Rhc2gvNC4xNy4xOS83S0E5OC1vRzY0SmM0SnRWdE5Pamk5cDlSNEk9L19fYnVpbGRfc3JjL191bmljb2RlVG9BcnJheS5qc5ihcgAGwMCRIMDCmaFkBgYjJpYkJSMZHSDAwpmhbKpyc01vZGlmaWVykiMywMDAGZDZT1ducG0vbG9kYXNoLzQuMTcuMTkvN0tBOTgtb0c2NEpjNEp0VnROT2ppOXA5UjRJPS9fX2J1aWxkX3NyYy9fdW5pY29kZVRvQXJyYXkuanOYoXIACsAkkSLAwpihcgsHwCWRHcDCmKFyCQbAwJEgwMKZoWQGBicplCgnGQrAwpmhbKtyc05vbkFzdHJhbJMnOkfAwMAZkNlPV25wbS9sb2Rhc2gvNC4xNy4xOS83S0E5OC1vRzY0SmM0SnRWdE5Pamk5cDlSNEk9L19fYnVpbGRfc3JjL191bmljb2RlVG9BcnJheS5qc5ihcgALwCiRJsDCmKFyCg3AwJEKwMKZoWQGJCorkioZwMKZoWyqcnNSZWdpb25hbJMqO0rAwMAZkNlPV25wbS9sb2Rhc2gvNC4xNy4xOS83S0E5OC1vRzY0SmM0SnRWdE5Pamk5cDlSNEk9L19fYnVpbGRfc3JjL191bmljb2RlVG9BcnJheS5qc5ihcgAKwMCRKcDCmaFkBicsLZIsGcDCmaFsqnJzU3VyclBhaXKTLDxLwMDAGZDZT1ducG0vbG9kYXNoLzQuMTcuMTkvN0tBOTgtb0c2NEpjNEp0VnROT2ppOXA5UjRJPS9fX2J1aWxkX3NyYy9fdW5pY29kZVRvQXJyYXkuanOYoXIACsDAkSvAwpmhZAYMLsCSLhnAwpmhbKVyc1pXSpIuOcDAwBmQ2U9XbnBtL2xvZGFzaC80LjE3LjE5LzdLQTk4LW9HNjRKYzRKdFZ0Tk9qaTlwOVI0ST0vX19idWlsZF9zcmMvX3VuaWNvZGVUb0FycmF5LmpzmKFyAAXAwJEtwMKYoWcBATBNkMDCmaFkBAYxM5QyMS8iwMKZoWyocmVPcHRNb2STMT5CwMDAL5DZT1ducG0vbG9kYXNoLzQuMTcuMTkvN0tBOTgtb0c2NEpjNEp0VnROT2ppOXA5UjRJPS9fX2J1aWxkX3NyYy9fdW5pY29kZVRvQXJyYXkuanOYoXIACMAykTDAwpihcgMKwMCRIsDCmaFkBgc0NpQ1NC8XwMKZoWyocnNPcHRWYXKTND1BwMDAL5DZT1ducG0vbG9kYXNoLzQuMTcuMTkvN0tBOTgtb0c2NEpjNEp0VnROT2ppOXA5UjRJPS9fX2J1aWxkX3NyYy9fdW5pY29kZVRvQXJyYXkuanOYoXIACMA1kTPAwpihcgkKwMCRF8DCmaFkBgA3P5k3LzgtJikrMzDAwpmhbKlyc09wdEpvaW6SN0PAwMAvkNlPV25wbS9sb2Rhc2gvNC4xNy4xOS83S0E5OC1vRzY0SmM0SnRWdE5Pamk5cDlSNEk9L19fYnVpbGRfc3JjL191bmljb2RlVG9BcnJheS5qc5ihcgAJwDiRNsDCmKFnAwc5wJY5Ojs8PT7AwpihcggFwDqRLcDCmKFyDAvAO5EmwMKYoXICCsA8kSnAwpihcgIKwD2RK8DCmKFyFAjAPpEzwMKYoXIDCMDAkTDAwpmhZAYAQESYQUJDQC8zMDbAwpmhbKVyc1NlcZJAVMDAwC+Q2U9XbnBtL2xvZGFzaC80LjE3LjE5LzdLQTk4LW9HNjRKYzRKdFZ0Tk9qaTlwOVI0ST0vX19idWlsZF9zcmMvX3VuaWNvZGVUb0FycmF5LmpzmKFyAAXAQZE/wMKYoXIDCMBCkTPAwpihcgMIwEORMMDCmKFyAwnAwJE2wMKZoWQGAEXAmEUvRiYdKSsawMKZoWyocnNTeW1ib2ySRVPAwMAvkNlPV25wbS9sb2Rhc2gvNC4xNy4xOS83S0E5OC1vRzY0SmM0SnRWdE5Pamk5cDlSNEk9L19fYnVpbGRfc3JjL191bmljb2RlVG9BcnJheS5qc5ihcgAIwEaRRMDCmKFnAxFHwJZHSElKS0zAwpihcgkLwEiRJsDCmKFyAwfASZEdwMKYoXIIB8BKkR3AwpihcgIKwEuRKcDCmKFyAgrATJErwMKYoXICCMDAkRrAwpihZwEBTlWQwMKZoWQEAE/Alk9NUCBEP8DCmaFsqXJlVW5pY29kZZJPV8DAwE2Q2U9XbnBtL2xvZGFzaC80LjE3LjE5LzdLQTk4LW9HNjRKYzRKdFZ0Tk9qaTlwOVI0ST0vX19idWlsZF9zcmMvX3VuaWNvZGVUb0FycmF5LmpzmKFyAAnAUJFOwMKYoWcDBlHAlFFSU1TAwpihcgcGwFKRIMDCmKFyCwbAU5EgwMKYoXIKCMBUkUTAwpihcgMFwMCRP8DCmaFkAQpWwJNXVk7AwpmhbK51bmljb2RlVG9BcnJheZJWXMDAwMCQ2U9XbnBtL2xvZGFzaC80LjE3LjE5LzdLQTk4LW9HNjRKYzRKdFZ0Tk9qaTlwOVI0ST0vX19idWlsZF9zcmMvX3VuaWNvZGVUb0FycmF5LmpzmKFyCQ7AV5FVwMKYoXIhCcDAkU7AwpehbwEAWV6QwJmhZAALWsCUW1xdWsDCmaFsrXN0cmluZ1RvQXJyYXmSWmDAwMDAkNlOV25wbS9sb2Rhc2gvNC4xNy4xOS83S0E5OC1vRzY0SmM0SnRWdE5Pamk5cDlSNEk9L19fYnVpbGRfc3JjL19zdHJpbmdUb0FycmF5LmpzmKFyCQ3AW5FZwMKYoXIUCsBckQHAwpihcgsOwF2RVcDCmKFyCwzAwJEGwMKYoWcBA1/AkMDCmKFnCQtgwJFgwMKYoXIADcDAkVnAwg==
====catalogjs annotation end====*/