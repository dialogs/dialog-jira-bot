const dotenv = require("dotenv");
const Bot = require("@dlghq/dialog-bot-sdk");
const {
  MessageAttachment,
  ActionGroup,
  Action,
  Button
} = require("@dlghq/dialog-bot-sdk");
const { flatMap } = require("rxjs/operators");
const axios = require("axios");
const { merge } = require("rxjs");
const moment = require("moment");

dotenv.config();

const credentials =
  process.env.JIRA_USERNAME + ":" + process.env.JIRA_API_TOKEN;
const credsBase64 = Buffer.from(credentials).toString("base64");
var inprogressIssues = "";
const headers = {
  Authorization: "Basic " + credsBase64,
  "Content-Type": "application/json"
};
var currentUserName = "";

async function run(token, endpoint) {
  const bot = new Bot.default({
    token,
    endpoints: [endpoint]
  });

  //fetching bot name
  const self = await bot.getSelf();
  console.log(`I've started, post me something @${self.nick}`);

  //get user
  bot.ready.then(response => {
    //mapping the current user
    response.dialogs.forEach(peer => {
      if (peer.type === "private") {
        console.log("peer", peer);
        getCurrentUser(bot, peer).then(res => (currentUserName = res));
      }
    });
  });

  bot.updateSubject.subscribe({
    next(update) {
      console.log(JSON.stringify({ update }, null, 2));
    }
  });

  //subscribing to incoming messages
  const messagesHandle = bot.subscribeToMessages().pipe(
    flatMap(async message => {
      if (
        message.content.type === "text" &&
        message.content.text === process.env.TEXT_MESSAGE
      ) {
        axios({
          url: process.env.JIRA_URL,
          method: "get",
          headers: headers
        })
          .then(response => {
            response.data.issues.map(issue => {
              if (issue.fields.creator.displayName === currentUserName) {
                const formattedText = formatJiraText(issue) + "\n";
                inprogressIssues += formattedText;
              }
            });
            sendTextToBot(bot, message);
            inprogressIssues = "";
          })
          .catch(err => {
            console.log(err);
          });
      }
    })
  );

  //creating action handle
  const actionsHandle = bot
    .subscribeToActions()
    .pipe(flatMap(async event => console.log(JSON.stringify(event, null, 2))));

  // merging actionHandle with messageHandle
  await new Promise((resolve, reject) => {
    merge(messagesHandle, actionsHandle).subscribe({
      error: reject,
      complete: resolve
    });
  });
}

//token to connect to the bot
const token = process.env.BOT_TOKEN;
if (typeof token !== "string") {
  throw new Error("BOT_TOKEN env variable not configured");
}

//bot endpoint
const endpoint =
  process.env.BOT_ENDPOINT || "https://grpc-test.transmit.im:9443";

run(token, endpoint).catch(error => {
  console.error(error);
  process.exit(1);
});

function formatJiraText(issue) {
  const timeInProgress = moment(issue.fields.updated).fromNow();
  const taskId = issue.key;
  const taskUrl = issue.self;
  const taskTitle = issue.fields.summary;
  const outputFormat =
    timeInProgress + " - " + "[" + taskId + "](" + taskUrl + ") :" + taskTitle;
  return outputFormat;
}

function sendTextToBot(bot, message) {
  bot.sendText(
    message.peer,
    inprogressIssues,
    MessageAttachment.reply(message.id)
  );
}

async function getCurrentUser(bot, peer) {
  const user = await bot.getUser(peer.id);

  return user.name;
}
