import {
  describeModule as astDescribeModule,
  ModuleDescription,
} from "../src/describe-module";
import { parse } from "@babel/core";

const { test } = QUnit;

function describeModule(js: string): ModuleDescription {
  let parsed = parse(js);
  if (parsed?.type !== "File") {
    throw new Error(`unexpected babel output`);
  }
  return astDescribeModule(parsed);
}

QUnit.module("describe-module", function () {
  test("pure reexport examples", function (assert) {
    let desc = describeModule(`
      export { foo } from './bar';
      export { x as y } from './baz';
      function bar() {};
      export { bar };
    `);
    assert.ok(desc.exports.exportedNames.has("foo"), "foo in exportedNames");
    assert.ok(desc.exports.exportedNames.has("bar"), "bar in exportedNames");
    assert.ok(desc.exports.exportedNames.has("y"), "y in exportedNames");
    assert.ok(desc.exports.reexports.has("foo"), "foo is a reexport");
    assert.equal(desc.exports.reexports.get("foo"), "foo", "foo is not named");
    assert.equal(desc.exports.reexports.get("y"), "x", "y is renamed from x");
    assert.ok(desc.exports.reexports.has("y"), "y is a reexport");
    assert.ok(!desc.exports.reexports.has("bar"), "bar is not a reexport");
  });

  test("export name is different than module-scoped name", function (assert) {
    let desc = describeModule(`
      const a = 1;
      export { a as b };
    `);
    assert.ok(desc.exports.exportedNames.has("b"), "b in exportedNames");
    assert.ok(!desc.exports.exportedNames.has("a"), "a not in exportedNames");
    assert.equal(
      desc.exports.exportedNames.get("b"),
      "a",
      "we can see that b comes from a"
    );
  });
});
