import CacheStorage from "./src/CacheStorage.js";
import AvatarService from "./src/AvatarService.js";
import MailService from "./src/MailService.js";
import SettingsManager from "./settings/SettingsManager.js";
import ContactsService from "./src/ContactsService.js";
import MessagesService from "./src/MessagesService.js";
import Author from "./src/Author.js";

let cache = new CacheStorage();
let settingsManager = new SettingsManager(cache);

let inboxListEnabled, contactsIntegrationEnabled;

/**
 * Refreshes the settings from the SettingsManager
 */
async function refreshSettings() {
  inboxListEnabled = await settingsManager.getInboxListEnabled();
  contactsIntegrationEnabled = await settingsManager.getContactsIntegrationEnabled();
}
await refreshSettings();

const avatarService = new AvatarService();
const mailService = new MailService(avatarService);
const contactsService = new ContactsService(mailService, avatarService);
const messagesService = new MessagesService(mailService, avatarService);

/**
 * Handles the need for additional data in a tab
 * @param {Object} tab Tab object
 * @param {Object} result Result object containing data
 */
async function handleNeedData(tab, result) {
  let dataPopups = result.data.popupValues;
  let urlsDict = {};
  for (let popup of dataPopups) {
    let mail = popup.mail;
    const author = await Author.fromAuthor(mail);
    let url = await avatarService.getAvatar(author);
    urlsDict[mail] = url;
  }
  let payload = {
    urls: urlsDict,
    data: result.data,
  };
  browser.headerApi.pictureHeadersConversation(tab.id, JSON.stringify(payload));
}

/**
 * Displays avatars in a tab
 * @param {Object} tab Tab object
 * @param {Array} messages Array of message objects
 */
async function displayInTab(tab, messages) {
  let urlsDict = {};
  for (let message of messages) {
    let urls = await mailService.getUrl(message, "messageHeader");
    urlsDict = { ...urlsDict, ...urls };
  }
  let urlDictJSON = JSON.stringify(urlsDict);
  let result = await browser.headerApi.pictureHeaders(tab.id, urlDictJSON);

  if (result.status === "needData") {
    handleNeedData(tab, result);
  }
}

/**
 * Handles the creation of a new contact
 * @param {Object} contactNode Contact node object
 */
async function onContactCreated(contactNode) {
  if (!contactsIntegrationEnabled) return;
  await contactsService.handleContactCreated(contactNode);
}

let folderChangeInProgress = false;

/**
 * Displays the inbox list in a tab
 * @param {Object} tab Tab object
 */
async function displayInboxList(tab, force = false, ignoreFirstReprint = false) {
  if (!inboxListEnabled) return;
  // Skip if a folder change is in progress and this is not the folder change call
  if (folderChangeInProgress && !ignoreFirstReprint) {
    console.log("[APP] displayInboxList SKIPPED - folderChangeInProgress");
    return;
  }
  console.log("[APP] displayInboxList START", { force, ignoreFirstReprint, folderChangeInProgress });
  try {
    await messagesService.displayInboxList(tab, false, force, ignoreFirstReprint);
    console.log("[APP] displayInboxList END");
  } catch (error) {
    console.warn("Error in displayInboxList:", error);
  }
}

/**
 * Initializes event listeners
 */
function initListeners() {
  browser.messageDisplay.onMessageDisplayed.addListener(async (tab, message) => {
    displayInTab(tab, [message]);
    displayInboxList(tab);
  });

  browser.messageDisplay.onMessagesDisplayed.addListener(
    async (tab, messages) => {
      displayInTab(tab, messages);
    }
  );

  browser.mailTabs.onDisplayedFolderChanged.addListener(async (tab) => {
    folderChangeInProgress = true;
    
    // Wait for messages to be loaded (max 2 seconds)
    let attempts = 0;
    const maxAttempts = 20;
    while (attempts < maxAttempts) {
      try {
        const tabId = tab?.id ?? (await browser.mailTabs.getCurrent()).id;
        const messages = await browser.mailTabs.getListedMessages(tabId);
        if (messages && messages.messages && messages.messages.length > 0) {
          break;
        }
      } catch (e) {
        // Ignore errors
      }
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    
    displayInboxList(tab, true, true);
    // Allow other calls after a short delay
    setTimeout(() => {
      folderChangeInProgress = false;
    }, 500);
  });

  browser.messages.onNewMailReceived.addListener(async (folder, messages) => {
    setTimeout(async () => {
      const currentTab = await browser.tabs.getCurrent();
      displayInboxList(currentTab);
    }, 1000);
  });

  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (tab.type !== "mail") {
      return;
    }
    displayInboxList(tab);
  });

  browser.runtime.onMessage.addListener(async (message, sender) => {
    if (message.action === "displayInboxList") {
      displayInboxList();
    } else if (message.action === "refreshSettings") {
      refreshSettings();
    }
  });

  messenger.contacts.onCreated.addListener(onContactCreated);

  browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (tab.status === "complete" && tab.type === "special") { // Thunderbird Conversations tab
      let result = await browser.headerApi.pictureHeaders(tabId, "{}");
      if (result.status === "needData") {
        handleNeedData(tab, result);
      }
    }
  });
}

initListeners();
if (inboxListEnabled) {
  displayInboxList();
}
