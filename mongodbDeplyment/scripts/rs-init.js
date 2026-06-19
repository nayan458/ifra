var result = rs.initiate({
  _id: "rs0",
  members: [
    { _id: 0, host: "mongodb-primary:27017", priority: 2 }
  ]
});

var isAlreadyInit = (result.codeName === "AlreadyInitialized");

if (result.ok !== 1 && !isAlreadyInit) {
  print("FAILED: " + JSON.stringify(result));
  quit(1);
}

print("SUCCESS: " + JSON.stringify(result));