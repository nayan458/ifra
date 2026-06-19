var status = rs.status();

var members = status.members.map(function(m) {
  return { name: m.name, state: m.stateStr };
});

print(JSON.stringify(members, null, 2));

var primary   = members.filter(function(m) { return m.state === "PRIMARY"; });
var secondary = members.filter(function(m) { return m.state === "SECONDARY"; });
var arbiter   = members.filter(function(m) { return m.state === "ARBITER"; });

if (primary.length !== 1 || secondary.length !== 1 || arbiter.length !== 1) {
  print("FAILED: unexpected replica set state");
  quit(1);
}

print("SUCCESS: replica set is healthy");