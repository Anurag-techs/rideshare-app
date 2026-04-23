const fs = require('fs');
const initSqlJs = require('sql.js');
const path = require('path');

const dbPath = path.join(__dirname, '../database.sqlite');
if (!fs.existsSync(dbPath)) {
  console.log('No database found.');
  process.exit(0);
}

initSqlJs().then(SQL => {
  const buffer = fs.readFileSync(dbPath);
  const db = new SQL.Database(buffer);

  function fixEncoding(text) {
    if (!text) return text;
    try {
      if (text.includes('ð') || text.includes('â')) {
        return decodeURIComponent(escape(text));
      }
    } catch {
      return text;
    }
    return text;
  }

  let count = 0;

  // Clean users
  let users = db.exec("SELECT id, name FROM users");
  if (users.length > 0) {
    users[0].values.forEach(row => {
      const fixed = fixEncoding(row[1]);
      if (fixed !== row[1]) {
        db.run("UPDATE users SET name = ? WHERE id = ?", [fixed, row[0]]);
        count++;
      }
    });
  }

  // Clean rides
  let rides = db.exec("SELECT id, from_location, to_location, notes, car_name FROM rides");
  if (rides.length > 0) {
    rides[0].values.forEach(row => {
      const fixedFrom = fixEncoding(row[1]);
      const fixedTo = fixEncoding(row[2]);
      const fixedNotes = fixEncoding(row[3]);
      const fixedCar = fixEncoding(row[4]);
      if (fixedFrom !== row[1] || fixedTo !== row[2] || fixedNotes !== row[3] || fixedCar !== row[4]) {
        db.run("UPDATE rides SET from_location = ?, to_location = ?, notes = ?, car_name = ? WHERE id = ?", [fixedFrom, fixedTo, fixedNotes, fixedCar, row[0]]);
        count++;
      }
    });
  }
  
  // Clean cars
  let cars = db.exec("SELECT id, model, color, license_plate FROM cars");
  if (cars.length > 0) {
    cars[0].values.forEach(row => {
      const fixedModel = fixEncoding(row[1]);
      const fixedColor = fixEncoding(row[2]);
      const fixedPlate = fixEncoding(row[3]);
      if (fixedModel !== row[1] || fixedColor !== row[2] || fixedPlate !== row[3]) {
        db.run("UPDATE cars SET model = ?, color = ?, license_plate = ? WHERE id = ?", [fixedModel, fixedColor, fixedPlate, row[0]]);
        count++;
      }
    });
  }

  if (count > 0) {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
    console.log(`Cleaned ${count} corrupted records in the DB.`);
  } else {
    console.log('No corrupted records found in the DB.');
  }
});
