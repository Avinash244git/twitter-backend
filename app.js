const express = require("express");
const app = express();

const path = require("path");
const dbPath = path.join(__dirname, "twitterClone.db");

const { open } = require("sqlite");
const sqlite3 = require("sqlite3");

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

app.use(express.json());

let db = null;

const initializeDbAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () => {
      console.log("server running at localhost:3000");
    });
  } catch (e) {
    console.log(`DB error '${e.message}'`);
    process.exit(1);
  }
};

initializeDbAndServer();

// register user API

app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    if (password.length >= 6) {
      const hashedPassword = await bcrypt.hash(password, 10);
      const createUserQuery = `INSERT INTO user (username,password,name,gender) VALUES ('${username}', '${hashedPassword}', '${name}', '${gender}');`;
      await db.run(createUserQuery);
      response.status(200);
      response.send("User created successfully");
    } else {
      response.status(400);
      response.send("Password is too short");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

// Login user API

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(selectUserQuery);
  if (dbUser !== undefined) {
    const isPasswordCorrect = await bcrypt.compare(password, dbUser.password);
    if (isPasswordCorrect) {
      const payload = { username, userId: dbUser.user_id };
      const jwtToken = jwt.sign(payload, "MY_SECRET_KEY");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  } else {
    response.status(400);
    response.send("Invalid user");
  }
});

// Authenticate User

const authenticateToken = (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_KEY", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        request.userId = payload.userId;
        next();
      }
    });
  }
};

const getFollowingPeopleIdsOfUser = async (username) => {
  const getFollowingPeopleIds = `SELECT following_user_id FROM follower INNER JOIN user ON user.user_id = follower.follower_user_id WHERE user.username = '${username}';`;
  const followingPeople = await db.all(getFollowingPeopleIds);
  const arrayIds = followingPeople.map(
    (eachObject) => eachObject.following_user_id
  );
  return arrayIds;
};

//API 3

app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;
  const followingPeopleIds = await getFollowingPeopleIdsOfUser(username);
  console.log(followingPeopleIds);
  const getTweetsQuery = `SELECT username, tweet, date_time AS dateTime FROM user INNER JOIN tweet ON user.user_id = tweet.user_id WHERE user.user_id IN (${followingPeopleIds})
  ORDER BY date_time DESC LIMIT 4;`;
  const tweets = await db.all(getTweetsQuery);
  response.send(tweets);
});

// API 4

app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username, userId } = request;
  const getFollowingQuery = `SELECT name FROM user INNER JOIN follower ON user.user_id = follower.following_user_id WHERE follower_user_id = ${userId};`;
  const dbArray = await db.all(getFollowingQuery);
  response.send(dbArray);
});

// API 5

app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username, userId } = request;
  const getFollowerUserQuery = `SELECT name FROM user INNER JOIN follower ON user.user_id = follower.follower_user_id WHERE following_user_id = '${userId}';`;
  const dbArray = await db.all(getFollowerUserQuery);
  response.send(dbArray);
});

// API 6

const tweetAccessVerification = async (request, response, next) => {
  const { userId } = request;
  const { tweetId } = request.params;
  const getTweetQuery = `SELECT * FROM tweet INNER JOIN follower ON tweet.user_id = follower.following_user_id WHERE follower_user_id = ${userId} AND tweet_id = ${tweetId};`;
  const queryResponse = await db.all(getTweetQuery);
  if (queryResponse.length === 0) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getTweetQuery = `SELECT tweet, (SELECT COUNT() FROM like WHERE tweet_id = ${tweetId}) AS likes, 
     (SELECT COUNT() FROM reply WHERE tweet_id = ${tweetId}) AS replies, date_time AS dateTime FROM tweet
     WHERE tweet_id = ${tweetId};`;
    const queryResponse = await db.get(getTweetQuery);
    response.send(queryResponse);
  }
);

// API 7

app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getTweetQuery = `SELECT username FROM user INNER JOIN like ON user.user_id = like.user_id WHERE tweet_id = ${tweetId};`;
    const queryResponse = await db.all(getTweetQuery);
    const arrayOutput = queryResponse.map((eachObject) => eachObject.username);
    response.send({ likes: arrayOutput });
  }
);

// API 8

app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  tweetAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getTweetQuery = `SELECT name, reply FROM user INNER JOIN reply ON user.user_id = reply.user_id WHERE tweet_id = ${tweetId};`;
    const queryResponse = await db.all(getTweetQuery);
    response.send({ replies: queryResponse });
  }
);

// API 9

app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const getTweetsQuery = `SELECT tweet,  COUNT(DISTINCT like_id) AS likes,  COUNT(DISTINCT reply_id)  AS replies, date_time AS dateTime FROM tweet 
  LEFT JOIN reply ON tweet.tweet_id = reply.tweet_id LEFT JOIN like ON tweet.tweet_id = like.tweet_id WHERE tweet.user_id = ${userId} GROUP BY tweet.tweet_id;`;
  const queryResponse = await db.all(getTweetsQuery);
  response.send(queryResponse);
});

// API 11

app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request.params;
    const { userId } = request;
    const getTweetQuery = `SELECT * FROM tweet WHERE user_id = ${userId} AND tweet_id = ${tweetId};`;
    const dbResponse = await db.get(getTweetQuery);
    if (dbResponse === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const deleteTweetQuery = `DELETE FROM tweet WHERE user_id = ${userId} AND tweet_id = ${tweetId};`;
      db.run(deleteTweetQuery);
      response.send("Tweet Removed");
    }
  }
);

// API 10
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const userId = parseInt(request.userId);
  const dateTime = new Date().toJSON().substring(0, 19).replace("T", " ");
  const insertTweetQuery = `INSERT INTO tweet (tweet, user_id, date_time) VALUES ('${tweet}', ${userId}, '${dateTime}');`;
  await db.run(insertTweetQuery);
  response.send("Created a Tweet");
});

module.exports = app;
