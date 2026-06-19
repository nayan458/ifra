var wc = db.adminCommand({
  setDefaultRWConcern: 1,
  defaultWriteConcern: { w: 1 }
});
if (wc.ok !== 1) {
  print("FAILED to set write concern: " + JSON.stringify(wc));
  quit(1);
}
print("Write concern set: " + JSON.stringify(wc));
var result1 = rs.add("mongodb-secondary:27017");
var secondaryOk = (result1.ok === 1) || (JSON.stringify(result1).indexOf("already") !== -1);
if (!secondaryOk) {
  print("FAILED to add secondary: " + JSON.stringify(result1));
  quit(1);
}
print("Added secondary: " + JSON.stringify(result1));
var result2 = rs.addArb("mongodb-arbiter:27017");
var arbiterOk = (result2.ok === 1) || (JSON.stringify(result2).indexOf("already") !== -1);
if (!arbiterOk) {
  print("FAILED to add arbiter: " + JSON.stringify(result2));
  quit(1);
}
print("Added arbiter: " + JSON.stringify(result2));
print("SUCCESS: all members added");