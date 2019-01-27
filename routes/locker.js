const express = require('express');
const mongodb = require('mongodb');
const ObjectID = require('mongodb').ObjectID;
const serverUrl = '192.168.254.100';
const serverPort = 27017;
const jwt = require('jsonwebtoken');
const config = require('../config');

const router = express.Router();

Object.prototype.constructError = function (errorCode, errorMsg) {
  this.success = false;
  if (!this.error_code) {
    this.error_code = [];
  }
  this.error_code.push(errorCode);

  if (!this.error_msg) {
    this.error_msg = [];
  }
  this.error_msg.push(errorMsg);

  if (errorCode === 02) {
    console.error(`Server error: ${errorMsg}`);
  }
}

Object.prototype.ObjectKeyMapper = function (oldKey, newKey) {
  let value = this[oldKey];

  delete this[oldKey];
  this[newKey] = value;
}

async function verifyObjectId(id, label, index) {
  return new Promise((resolve, reject) => {
    try {
      let objectId = new ObjectID(id);

      resolve(objectId);
    } catch (error) {
      reject(error);
    }

  });
}

async function loadMongoDB() {
  const client = await mongodb.MongoClient.connect(`mongodb://${serverUrl}:${serverPort}`, {
    useNewUrlParser: true
  });

  return client;
}

async function loadCollections(collectionName) {
  const client = await loadMongoDB();

  return client.db('Thesis').collection(collectionName);
}

router.use((req, res, next) => {
  const token = req.body.token || req.query.token || req.headers['x-access-token'];

  let body = {};

  if(token) {
    jwt.verify(token, config.secret, (err, decoded) => {
      if(err) {
        body.constructError(05, 'Failed to authenticate');
        return res.send(body);
      }else {
        req.decoded = decoded;
        next();
      }
    })
  }else {
    body.constructError(05, 'Please encode a valid token');

    return res.status(403).send(body);
  }

});

router.get('/esp-test', async (req, res) => {
  console.log('connection success');
  res.status(200).send('test');
});

router.post('/esp-test', async (req, res) => {
  let body = req.body.data;
  console.log('connection success');
  res.status(200).send(JSON.stringify(body));
});

router.get('/unit-list', async (req, res) => {
  const lockers = await loadCollections('Locker_Units');
  const area = req.body.area_num || null;

  let body = {};

  if (area) {
    await lockers
      .find({
        'unit_area': area
      }, {
        projection: {
          'slave_address': 0
        }
      })
      .toArray()
      .then(data => {
        let body = {};

        if (data.length > 0) {
          for (let i = 0; i < data.length; i++) {
            data[i].ObjectKeyMapper('_id', 'unit_id');
          }

          body.data = data;
          body.success = true;
        } else {
          body.constructError(00, `Area number #${area} not found.`);
        }

        res.send(body);
      })
      .catch(err => {
        body.constructError(02, err);
        res.send(body);
      })
  } else {
    body.constructError(01, 'Area number parameter is required.');
    res.send(body);
  }

});

router.get('/area-list', async (req, res) => {
  const areas = await loadCollections('Locker_Area');

  let body = {};
  await areas
    .find({})
    .toArray()
    .then(data => {
      for (let i = 0; i < data.length; i++) {
        data[i].ObjectKeyMapper('_id', 'area_id');
      }

      body.data = data;
      body.success = true;

      res.send(body);
    })
    .catch(err => {
      body.constructError(02, err);
      res.send(body);
    })
});

router.get('/area-info', async (req, res) => {
  const areas = await loadCollections('Locker_Area');
  const areaId = req.body.area_id || req.query.area_id || null;

  let body = {};

  if(areaId){
    verifyObjectId(areaId)
      .then(async id => {
        await areas
        .find({
          '_id': id
        })
        .toArray()
        .then(data => {
          if(data.length > 0){
            bodyData = data[0];

            bodyData.ObjectKeyMapper('_id', 'area_id');

            body.data = bodyData;
            body.success = true;

            res.send(body);
          }else{
            body.constructError(00, `Found no information available on area ID ${id}.`);
          }
          res.send(body);
        })
        .catch(err => {
          body.constructError(02, err);
          res.send(body);
        })
      })
      .catch(err => {
        console.error(err);
        body.constructError(03, `Please encode a valid Area ID format and value.`);
        res.send(body);
      });
  }else{
    body.constructError(01, 'Area ID parameter is required.');
    res.send(body);
  }

  // res.send(body);
});

router.get('/suggest-unit', async (req, res) => {
  const lockers = await loadCollections('Locker_Units');
  var area = req.body.area_num || req.query.area_num || null;

  area = parseInt(area);

  let body = {};

  if(area){
    await lockers
      .find({
        'unit_area': area,
        'unit_status': 'available'
      }, {
        projection: {
          'slave_address': 0
        }
      })
      .toArray()
      .then(data => {
        let body = {};

        if (data.length > 0) {
          let max = data.length - 1;
          let min = 0;
          let randomIndex = Math.floor(Math.random()*(max-min+1)+min); 
          let bodyData = data[randomIndex];

          bodyData.ObjectKeyMapper('_id', 'unit_id');

          body.data = bodyData;
          body.success = true;
        } else {
          body.constructError(00, `No available locker units on Area #${area}.`);
        }

        res.send(body);
      })
      .catch(err => {
        body.constructError(02, err);
        res.send(body); 
      })
  }else{
    body.constructError(01, 'Area number parameter is required.');
    res.send(body);
  }

});

router.post('/transaction/authorization', async (req, res) => {
  const currTime = Math.floor((new Date).getTime()/1000);
  const rentalInfos = await loadCollections('Rental_Unit_Info');
  const sessionLogs = await loadCollections('Session_Log');
  const activityType = ['rent_auth', 'extend_auth', 'overdue_auth','reserve_auth' , 'rent_session', 'extend_session', 'overdue_session', 'reserve_session', 'unit_usage'];
  const activityObj = {
    RENT_AUTH: activityType[0],
    EXTEND_AUTH: activityType[1],
    OVERDUE_AUTH: activityType[2],
    RESERVE_AUTH: activityType[3],
    RENT_SESSION: activityType[4],
    EXTEND_SESSION: activityType[5],
    OVERDUE_SESSION: activityType[6],
    RESERVE_SESSION: activityType[7],
    UNIT_USAGE: activityType[8],
  }

  const unitId = req.body.unit_id || null;
  const userId = req.decoded.user_id || null;
  const transactionType = req.body.transaction_type || null;

  let apiCodes = [];
  let body = {};

  async function isUserAuthorized(userId, type) {
    if (userId) {
      try {
        let id = new ObjectID(userId);

        if([activityObj.RENT_AUTH, // rent_auth
            activityObj.RENT_SESSION, // rent_session
            activityObj.RESERVE_AUTH, // reserve_auth
            activityObj.RESERVE_SESSION // reserve_session
        ].includes(type)){
          return await isSessionAvailable('user_id', userId)
            .then(isAvailable => {
              return Promise.resolve(isAvailable);
            })
            .catch(err => {
              return Promise.reject(false);
            });
        }else{

        }

      } catch (error) {
        body.constructError(3.2, 'Please encode a valid User ID format and value.');
        return Promise.reject(false);
      }
    } else {
      body.constructError(1.2, `User ID parameter is required.`);
      return Promise.reject(false);
    }
  }

  async function isUnitAuthorized(unitId, type) {
    if (unitId) {
      try {
        let id = new ObjectID(unitId);
        
        if([activityObj.RENT_AUTH, // rent_auth
            activityObj.RENT_SESSION, // rent_session
            activityObj.RESERVE_AUTH, // reserve_auth
            activityObj.RESERVE_SESSION // reserve_session
        ].includes(type)){
          return await isSessionAvailable('unit_id', unitId)
            .then(isAvailable => {
              return Promise.resolve(isAvailable);
            })
            .catch(err => {
              return Promise.reject(false);
            });
        }else{
          
        }
        
      } catch (error) {
        console.log(error);
        body.constructError(3.1, 'Please encode a valid Unit ID format and value.');
        return Promise.reject(false);
      }
    } else {
      body.constructError(1.1, 'Unit ID parameter is required.');
      return Promise.reject(false);
    }
  }

  async function isTransactionTypeValid(transactionType) {
    if(transactionType){
      if(activityType.includes(transactionType)){
        return Promise.resolve(true);
      }else{
        body.constructError(3, 'Please encode a valid transaction type format and value.');
        return Promise.reject(false);
      }
    }else{
      body.constructError(1, `Transaction type parameter is required.`);
      return Promise.reject(false);
    }
  }

  async function isSessionAvailable(idKey, idValue){
    queryObj = {};
    queryObj[idKey] = idValue;
    
    return await rentalInfos
      .findOne(queryObj)
      .then(async rentalData => {
        let sessionId = rentalData.session_id || null;
        if(sessionId){
          try {
            let objectId = new ObjectID(sessionId);
            
            if (!!rentalData) {
              if(['occupied', 'reserved'].includes(rentalData.mode)){
                return await sessionLogs
                  .findOne({
                    '_id': objectId
                  })
                  .then(async sessionData => {
                    let sessionEndTime = parseFloat(sessionData.end_date);
                      
                    if((sessionEndTime - currTime) > 0){
                      let apiCode;
                      if(idKey == 'unit_id'){
                        apiCode = 1;
                      }else if(idKey == 'user_id'){
                        apiCode = 2;
                      }

                      apiCodes.push(apiCode);
                      
                      return Promise.resolve(false);
                    }else{
                      await rentalInfos
                        .updateOne(
                          queryObj
                        , {
                          $set: {
                            "mode": "available"
                          }
                        })
                      return Promise.resolve(true);
                    }
                  })
              }else if(rentalData.mode == 'available'){
                return Promise.resolve(true);
              } 
            } else {
              return Promise.resolve(true);
            }
          } catch (error) {
            body.constructError(03, `Please encode a valid Session ID format and value.`);
            return Promise.resolve(false);
          }
        }else{
          body.constructError(1.2, `Session ID parameter is required.`);
          return Promise.reject(false);
        }
      })
      .catch(err => {
        body.constructError(02, err);
        return Promise.reject(false);
      });
  }

  await Promise.all([
    isUnitAuthorized(unitId, transactionType),
    isUserAuthorized(userId, transactionType),
    isTransactionTypeValid(transactionType)
  ]).then(async auth => {
    const activityLogs = await loadCollections('Unit_Activity_Logs');

    let unitAuthorized = auth[0];
    let userAuthorized = auth[1];
    let rentAuthorized = await unitAuthorized && await userAuthorized;

    activityLogs.insertOne({
      'type': 'rent_authorize',
      'date': currTime,
      'authorized': await rentAuthorized,
      'user_id': userId,
      'unit_id': unitId
    }, {}, (err, result) => {
      if (!err && (result.insertedCount >= 1)) {
        let data = {
          'activity_log_id': result.insertedId,
          'authorized': rentAuthorized
        }

        body.data = data;
        apiCodes.length > 0 ? body.data.api_msg_code = apiCodes : null;
        body.success = true;

        res.send(body);
      } else {
        body.constructError(02, 'There is a problem checking your unit. Please try again later.');
        res.send(body);
      }
    })
  }).catch(err => {
    console.error(err);
    res.send(body);
  });
});

router.post('/transaction/feed', async (req, res) => {

  const authLogId = req.body.auth_activity_log_id || null;
  const amount = req.body.transaction_amount || null;
  const transactionType = req.body.transaction_type || null;
  const userId = req.body.user_id || null;

  let body = {};

  !amount ? body.constructError(01, `Amount parameter is required.`) : null;
  !transactionType ? body.constructError(01, `Transaction type parameter is required.`) : null;
  !userId ? body.constructError(01, `User Id parameter is required.`) : null;

  if (amount && transactionType && userId) {
    verifyObjectId(userId)
      .then(async id => {
        await isFeedAuthorized(authLogId)
          .then(async isAuth => {
            async function isUpdateAuthorized() {
              return new Promise(async (resolve, reject) => {
                if (isAuth) {
                  const transactionLogs = await loadCollections('Transaction_Log');

                  await transactionLogs
                    .insertOne({
                      'type': transactionType,
                      'amount': amount,
                      'date': null,
                      'user_id': userId
                    })
                    .then(data => {
                      resolve(data);
                    })
                    .catch(err => {
                      console.error(err);
                      reject(err);
                    })
                } else {
                  res.send('not auth');
                }
              })
            }

            body.data = {
              'transaction_authorized': false,
              'user_id': userId,
              'date': null
            };
            body.success = true;

            isUpdateAuthorized()
              .then(result => {
                body.data.transaction_authorized = true;
                res.send(body);
              })
              .catch(err => {
                console.error(err);
                body.success = true;
                res.send(body);
              })
          })
          .catch(bodyError => {
            res.send(bodyError);
          })
      })
      .catch(err => {
        body.constructError(03, `Please encode a valid User ID format and value.`);
        res.send(body);
      })
  } else {
    res.send(body);
  }
});

router.post('/transaction/acquire', async (req, res) => {

  const payload = req.body;
  const userId = payload.user_id || null;
  const acquireType = payload.acquire_type || null;
  const authLogId = payload.auth_activity_log_id || null;

  let body = {};

  !userId ? body.constructError(01, `User ID parameter is required.`) : null;
  !authLogId ? body.constructError(01, `Authorization Log ID parameter is required.`) : null;
  !acquireType ? body.constructError(01, `Acquire type parameter is required.`) : null;

  if (userId && authLogId && acquireType) {
    const unitActivityLogs = await loadCollections('Unit_Activity_Logs');

    await isFeedAuthorized(authLogId)
      .then(async isAuth => {
        if (isAuth) {
          let type = null;
          switch (acquireType) {  
            case 'Rent':
              type = 'start_session';
              break;
            case 'Extend':
              type = 'extend_session';
              break;
            case 'Reserve':
              type = 'reserve';
              break;
            default:
              type = null;
          }
          await unitActivityLogs
            .insertOne({
              'type': type,
              'date': null,
              'authorized': true,
              'user_id': userId,
              'unit_id': '1234'
            })
            .then(result => {
              let data = {
                'acquire_type': type,
                'user_id': userId
              }

              body.data = data;
              body.success = true;

              res.send(body);
            })
            .catch(err => {
              console.error(err);
              res.send(body);
            })
        } else {
          body.constructError(04, 'Authorized Log is not valid');
          res.send(body);
        }
      })
      .catch(err => {
          body.constructError(03, 'Please encode a valid Authorized Log ID format and value.');
          res.send(err);
      })
  }else{
    res.send(body);
  }

});

async function isFeedAuthorized(authLogId) {
  if (authLogId) {
    return new Promise((resolve, reject) => {
      verifyObjectId(authLogId)
        .then(async id => {
          const unitActivityLogs = await loadCollections('Unit_Activity_Logs');

          await unitActivityLogs
            .find({
              '_id': id
            }, {
              projection: {
                'authorized': 1,
                'type': 1,
                '_id': 0
              }
            })
            .toArray()
            .then(data => {
              if (data.length > 0) {
                let thisData = data[0];
                let isAuth = false;
                let isRentAuth = false;

                if (thisData.type === 'rent_authorize') {
                  isRentAuth = true;
                  if (thisData.authorized) {
                    isAuth = true;
                  } else {
                    let bodyError = {};
                    bodyError.constructError(04, `Rental transaction is not authorized.`);

                    return reject(bodyError);
                  }
                } else {
                  let bodyError = {};
                  bodyError.constructError(04, `Activity log is not of rent auth type.`);

                  return reject(bodyError);
                }
                if (isAuth && isRentAuth) {
                  // body.data = data;
                  // body.success = true;
                  return resolve(true);
                } else {
                  // body.success = true;
                  return resolve(false);
                }
              } else {
                let bodyError = {};
                bodyError.constructError(0, `Activity log with ID ${authLogId} not found.`);

                return reject(bodyError);
                // return reject(false);
              }
            })
            .catch(err => {
              let bodyError = {};
              bodyError.constructError(02, err);

              return reject(bodyError);
              // return reject(false);
            })
        })
        .catch(err => {
          let bodyError = {};

          bodyError.constructError(03, 'Please encode a valid Authorized Log ID format and value.');
          reject(bodyError);
        })
    });
  } else {
    let bodyError = {};
    bodyError.constructError(01, `Activity log ID of rental authentication is required.`);
    return Promise.reject(bodyError);
  }
}

module.exports = router;