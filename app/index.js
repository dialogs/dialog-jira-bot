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
const _ = require("lodash");

dotenv.config();
//token to connect to the bot
const token = process.env.BOT_TOKEN;
if (typeof token !== "string") {
  throw new Error("BOT_TOKEN env variable not configured");
}

//bot endpoint
const endpoint =
  process.env.BOT_ENDPOINT || "https://grpc-test.transmit.im:9443";

const credentials =
  process.env.JIRA_USERNAME + ":" + process.env.JIRA_API_TOKEN;
const credsBase64 = Buffer.from(credentials).toString("base64");
const headers = {
  Authorization: "Basic " + credsBase64,
  "Content-Type": "application/json"
};
var tasksToTrack = [];
const currentUser = { name: "", peer: "" };

const bot = new Bot.default({
  token,
  endpoints: [endpoint]
});

bot.ready.then(response => {
  //mapping the current user
  response.dialogs.forEach(peer => {
    if (peer.type === "private") {
      getCurrentUser(bot, peer);
    }
  });
});

//fetching bot name
const self = bot
  .getSelf()
  .then(response => {
    console.log(`I've started, post me something @${response.nick}`);
  })
  .catch(err => console.log(err));

bot.updateSubject.subscribe({
  next(update) {
    // console.log(JSON.stringify({ update }, null, 2));
  }
});

//subscribing to incoming messages
const messagesHandle = bot.subscribeToMessages().pipe(
  flatMap(async message => {
    const wordsArray = message.content.text.split(" ");
    console.log("MESSAGE", wordsArray);

    if (wordsArray[0] === "Remind" && wordsArray[1] === "about") {
      let result = await axios({
        url: process.env.JIRA_ISSUE_URL + wordsArray[2],
        method: "get",
        headers: headers
      })
        .then(response => {
          const issue = {
            task: response.data.key,
            status: response.data.fields.status.name
          };
          tasksToTrack.push(issue);
        })
        .catch(err => {
          console.log(err);
        });
    } else if (wordsArray[0] === "Stop" && wordsArray[1] === "reminding") {
      console.log("logs", containsValue(tasksToTrack, wordsArray[2]));
      if (containsValue(tasksToTrack, wordsArray[2])) {
        _.remove(tasksToTrack, function(n) {
          console.log("nnnnn", n, wordsArray[2]);
          return n.task === wordsArray[2];
        });
        console.log("remaining", tasksToTrack);
      }
    }

    setInterval(async function() {
      let result = await axios({
        url: process.env.ALL_ISSUE_JIRA_URL,
        method: "get",
        headers: headers
      }).then(response => {
        response.data.issues.map(issue => {
          if (
            containsValue(tasksToTrack, issue.key) &&
            issue.fields.status.name !== issueStatus(issue.key)
          ) {
            tasksToTrack.map(task => {
              if (task.task === issue.key) {
                task.status = issue.fields.status.name;
              }
            });
            const task = formatJiraText(issue);
            sendTextMessage(task);
          }
        });
      });
    }, 3000);
  })
);

//creating action handle
const actionsHandle = bot
  .subscribeToActions()
  .pipe(flatMap(async event => console.log(JSON.stringify(event, null, 2))));

// merging actionHandle with messageHandle
new Promise((resolve, reject) => {
  merge(messagesHandle, actionsHandle).subscribe({
    error: reject,
    complete: resolve
  });
});

// general functions
function formatJiraText(issue) {
  const status = issue.fields.status.name;
  const taskId = issue.key;
  const taskUrl = issue.self;
  const taskTitle = issue.fields.summary;
  const outputFormat =
    status + " - " + "[" + taskId + "](" + taskUrl + ") :" + taskTitle;
  return outputFormat;
}
function selectOptionFormat(options) {
  var selectOptions = [];
  options.map(option => {
    selectOptions.push(new SelectOption(option.label, option.value));
  });

  return selectOptions;
}

//actionOptions is an array of format [{type:"", id: "", label: "", options: ""}]
function actionFormat(actionOptions) {
  var actions = [];
  actionOptions.map(options => {
    if (options.type === "select") {
      const selectOptions = selectOptionFormat(options.options);

      var action = Action.create({
        id: options.id,
        widget: Select.create({
          label: options.label,
          options: selectOptions
        })
      });

      actions.push(action);
    } else if (options.type === "button") {
      var action = Action.create({
        id: options.id,
        widget: Button.create({ label: options.label })
      });

      actions.push(action);
    }
  });

  return actions;
}

//actions is an array of format [{type:"" , id: "" , label: "" , options: ""}]
function sendTextMessage(text, actions) {
  var messageToSend = messageformat(text);
  var action = actions || null;
  var actionGroup = null;
  if (action !== null) {
    actionGroup = ActionGroup.create({
      actions: actionFormat(action)
    });
  }
  sendTextToBot(bot, messageToSend, actionGroup);
}

function messageformat(text) {
  var message = { peer: currentUser.peer, text: text };
  return message;
}

function sendTextToBot(bot, message, actionGroup) {
  var actionGroups = actionGroup || null;
  bot
    .sendText(
      message.peer,
      message.text,
      MessageAttachment.reply(null),
      actionGroups
    )
    .then(response => console.log("res", response))
    .catch(err => console.log("err", err));
}

async function getCurrentUser(bot, peer) {
  const user = await bot.getUser(peer.id);
  currentUser.name = user.name;
  currentUser.peer = peer;
}

function containsValue(array, value) {
  valuePresent = false;
  array.map(object => {
    if (object.task === value) {
      valuePresent = true;
    }
  });
  return valuePresent;
}

function issueStatus(key) {
  var status = "";
  tasksToTrack.map(taskTracked => {
    if (taskTracked.task === key) {
      status = taskTracked.status;
    }
  });
  return status;
}
