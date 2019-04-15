
# Jira Active Tasks Bot

A bot to fetch all the active tasks for a particular user from a particular account.

You can clone the respository or download the zip file.

## Steps to run the bot:

1. Navigate to the project folder and run:
```sh
    $ npm install
```
2. Create a .env file and add the following details

```sh
    BOT_ENDPOINT=https://grpc-test.transmit.im:9443
    BOT_TOKEN=xxxxxxxxxx
    JIRA_USERNAME=xxxxxxxxxx
    JIRA_API_TOKEN=xxxxxxx
    TEXT_MESSAGE=Jarvis
    JIRA_URL=https://domain.atlassian.net/rest/api/2/search?jql=status=%22In+Progress%22
```

- BOT_TOKEN can be generated by creating a new bot on dialog app.
- JIRA_USERNAME is the email id which you used to sign up on JIRA.
- JIRA_API_TOKEN is your jira account password.
- TEXT_MESSAGE is the text you want to trigger the bot to fetch JIRA In Progress tasks.
- JIRA_URL  replace the 'domain' with your own jira domain name and rest of the URL remains same.

3. Run the command:
```sh
   $ node app/index.js
```
4. Type the text in the dialog bot that you set in .env file
