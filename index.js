/**
 * Copyright 2018, Google, Inc.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const fs = require('fs');
const google = require('googleapis');
const gmail = google.gmail('v1');
const cheerio = require(`cheerio`);
const querystring = require(`querystring`);

const Datastore = require('@google-cloud/datastore');
const datastore = new Datastore();

const Vision = require('@google-cloud/vision');
const visionClient = new Vision.ImageAnnotatorClient();

const pify = require('pify');

const DebugAgent = require('@google-cloud/debug-agent');
DebugAgent.start();

// Configuration constants
// TODO(developer): update these values
const GCF_REGION = 'YOUR_GCF_REGION';
const GCLOUD_PROJECT = 'YOUR_GCLOUD_PROJECT_ID';

// Computed values
const GCF_BASE_URL = `https://${GCF_REGION}-${GCLOUD_PROJECT}.cloudfunctions.net`;
const TOPIC_NAME = `projects/${GCLOUD_PROJECT}/topics/anassri-gmail-test`;

// Retrieve OAuth2 config
const clientSecretJson = JSON.parse(fs.readFileSync('./client_secret.json'));
const oauth2Client = new google.auth.OAuth2(
  clientSecretJson.web.client_id,
  clientSecretJson.web.client_secret,
  `${GCF_BASE_URL}/oauth2callback`
);

/**
 * Helper function to get the current user's email address
 */
const getEmailAddress = (t) => {
  return pify(gmail.users.getProfile)({
    auth: oauth2Client,
    userId: 'me'
  }).then(x => x.emailAddress);
};

/**
 * Helper function to fetch a user's OAuth 2.0 access token
 * Can fetch current tokens from Datastore, or create new ones
 */
const UNKNOWN_USER_MESSAGE = 'Uninitialized email address';
const fetchToken = (emailAddress) => {
  return datastore.get(datastore.key(['oauth2Token', emailAddress]))
    .then((tokens) => {
      const token = tokens[0];

      // Check for new users
      if (!token) {
        throw new Error(UNKNOWN_USER_MESSAGE);
      }

      // Validate token
      if (!token.expiry_date || token.expiry_date < Date.now() + 60000) {
        oauth2Client.credentials.refresh_token = oauth2Client.credentials.refresh_token || token.refresh_token;
        return new Promise((resolve, reject) => { // Pify and oauth2client don't mix
          oauth2Client.refreshAccessToken((err, response) => {
            if (err) {
              return reject(err);
            }
            return resolve();
          });
        })
          .then(() => {
            return saveToken(emailAddress);
          });
      } else {
        oauth2Client.credentials = token;
        return Promise.resolve();
      }
    });
};

/**
 * Helper function to save an OAuth 2.0 access token to Datastore
 */
const saveToken = (emailAddress) => {
  return datastore.save({
    key: datastore.key(['oauth2Token', emailAddress]),
    data: oauth2Client.credentials
  });
};

/**
 * Request an OAuth 2.0 authorization code
 * Only new users (or those who want to refresh
 * their auth data) need visit this page
 */
exports.oauth2init = (req, res) => {
  // Define OAuth2 scopes
  const scopes = [
    'https://www.googleapis.com/auth/gmail.modify'
  ];

  // Generate + redirect to OAuth2 consent form URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent' // Required in order to receive a refresh token every time
  });
  return res.redirect(authUrl);
};

/**
 * Get an access token from the authorization code and store token in Datastore
 */
exports.oauth2callback = (req, res) => {
  // Get authorization code from request
  const code = req.query.code;

  // OAuth2: Exchange authorization code for access token
  return new Promise((resolve, reject) => {
    oauth2Client.getToken(code, (err, token) =>
      (err ? reject(err) : resolve(token))
    );
  })
    .then((token) => {
      // Get user email (to use as a Datastore key)
      oauth2Client.credentials = token;
      return Promise.all([token, getEmailAddress()]);
    })
    .then(([token, emailAddress]) => {
      // Store token in Datastore
      return Promise.all([
        emailAddress,
        saveToken(emailAddress)
      ]);
    })
    .then(([emailAddress]) => {
      // Respond to request
      res.redirect(`/initWatch?emailAddress=${querystring.escape(emailAddress)}`);
    })
    .catch((err) => {
      // Handle error
      console.error(err);
      res.status(500).send('Something went wrong; check the logs.');
    });
};

/**
 * Initialize a watch on the user's inbox
 */
exports.initWatch = (req, res) => {
  // Require a valid email address
  if (!req.query.email) {
    return res.status(400).send('No emailAddress specified.');
  }
  const email = querystring.unescape(req.query.email);
  if (!email.includes('@')) {
    return res.status(400).send('Invalid emailAddress.');
  }

  // Retrieve the stored OAuth 2.0 access token
  return fetchToken(email)
    .then(() => {
      // Initialize a watch
      return pify(gmail.users.watch)({
        auth: oauth2Client,
        userId: 'me',
        resource: {
          labelIds: ['INBOX'],
          topicName: TOPIC_NAME
        }
      });
    })
    .then(() => {
      // Respond with status
      res.write(`Watch initialized!`);
      res.status(200).end();
    })
    .catch((err) => {
      // Handle errors
      if (err.message === UNKNOWN_USER_MESSAGE) {
        res.redirect('/oauth2init');
      } else {
        console.error(err);
        res.status(500).send('Something went wrong; check the logs.');
      }
    });
};

/**
 * Get base64-encoded image attachments in a GMail message
 * @param message The GMail message to extract images from
 * @returns A promise containing a list of base64-encoded images
 */
const getImageAttachments = (message) => {
  // Get attachment data
  const attachmentIds = message.payload.parts
    .filter(x => x.mimeType && x.mimeType.includes('image'))
    .map(x => x.body.attachmentId);

  // Return base64-encoded images
  return Promise.all(attachmentIds.map(attachmentId => {
    return pify(gmail.users.messages.attachments.get)({
      auth: oauth2Client,
      userId: 'me',
      id: attachmentId,
      messageId: message.id
    }).then(result => {
      // Convert from base64url to base64
      const imageData = result.data.replace(/-/g, '+').replace(/_/g, '/');
      return Buffer.from(imageData, 'base64');
    });
  }));
};

/**
 * Get URL-referenced images in a GMail message
 * @param message The GMail message to extract images from
 * @returns A list of image URLs
 */
const getImageUrls = (message) => {
  const unpack = (x) => {
    return Buffer.from(x.body.data || '', 'base64').toString();
  };

  // Get message's HTML
  let rawHtml = message.payload.parts.map(
    p => unpack(p)
  ).join('');
  rawHtml += unpack(message.payload);

  // Return image URLs
  return cheerio.load(rawHtml)('img')
    .toArray()
    .map(image => image.attribs.src);
};

/**
 * Get all images from a GMail message
 * @param message The GMail message to extract images from
 * @returns A promise containing a list of {image URLs, base64-encoded images}
 */
const getAllImages = (msg) => {
  const urlImages = getImageUrls(msg);
  const base64Images = getImageAttachments(msg);
  return Promise.all([urlImages, base64Images])
    .then(([urlImages, base64Images]) => urlImages.concat(base64Images));
};

/**
 * List GMail message IDs
 * @returns A promise containing a list of GMail message IDs
 */
const listMessageIds = () => {
  return pify(gmail.users.messages.list)(
    { auth: oauth2Client, userId: 'me' }
  );
};

/**
 * Get a GMail message given a message ID
 * @param messageId The ID of the message to get
 * @returns A promise containing the specified GMail message
 */
const getMessageById = (messageId) => {
  return pify(gmail.users.messages.get)({
    auth: oauth2Client,
    id: messageId,
    userId: 'me'
  });
};

/**
 * Label a GMail message
 * @param messageId The ID of the message to label
 * @param labels The labels to apply to the message
 */
const labelMessage = (messageId, labels) => {
  return pify(gmail.users.messages.modify)({
    auth: oauth2Client,
    id: messageId,
    userId: 'me',
    resource: {
      addLabelIds: labels
    }
  });
};

/**
 * Get labels for a series of images
 * @param images A list of {base64-encoded images, image URLs} to label
 * @param returns A flattened list of labels for the specified images
 */
const getLabelsForImages = (images) => {
  // Get labels for each images
  const requests = images.map(image => visionClient.labelDetection(image));

  return Promise.all(requests)
    .then(results => {
      // Propagate request errors (to be caught elsewhere)
      if (results[0].error) {
        throw new Error(results[0].error);
      }

      // Map to label array-of-arrays
      return results.map(result =>
        result[0].labelAnnotations.map(label => label.description)
      );
    })
    .then(labelSet => {
      // Flatten labelSet
      return labelSet.reduce((x, y) => x.concat(y), []);
    });
};

/**
* Process new messages as they are received
*/
const NO_LABEL_MATCH = `Message doesn't match label`;
exports.onNewMessage = (event) => {
  // Parse the Pub/Sub message
  const dataStr = Buffer.from(event.data.data, 'base64').toString('ascii');
  const dataObj = JSON.parse(dataStr);

  return fetchToken(dataObj.emailAddress)
    .then(listMessageIds)
    .then(res => getMessageById(res.messages[0].id)) // Most recent message
    .then(msg => Promise.all([msg, getAllImages(msg)]))
    .then(([msg, images]) => Promise.all([msg, getLabelsForImages(images)]))
    .then(([msg, labels]) => {
      if (!labels.includes('bird')) {
        throw new Error(NO_LABEL_MATCH); // Exit promise chain
      }

      return labelMessage(msg.id, ['STARRED']);
    })
    .catch((err) => {
      // Handle unexpected errors
      if (!err.message || err.message !== NO_LABEL_MATCH) {
        console.error(err);
      }
    });
};
