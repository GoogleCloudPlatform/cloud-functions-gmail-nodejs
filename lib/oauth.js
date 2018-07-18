/**
 * Copyright 2018, Google LLC
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

const config = require('../config');
const Datastore = require('@google-cloud/datastore');
const datastore = new Datastore();
const path = require('path');
const pify = require('pify');
const fs = require('fs');
const google = require('googleapis');
const gmail = google.gmail('v1');

// Retrieve OAuth2 config
const clientSecretPath = path.join(path.dirname(__dirname), 'client_secret.json');
const clientSecretJson = JSON.parse(fs.readFileSync(clientSecretPath));
const oauth2Client = new google.auth.OAuth2(
  clientSecretJson.web.client_id,
  clientSecretJson.web.client_secret,
  `${config.GCF_BASE_URL}/oauth2callback`
);
exports.client = oauth2Client;

/**
 * Helper function to get the current user's email address
 */
exports.getEmailAddress = (t) => {
  return pify(gmail.users.getProfile)({
    auth: oauth2Client,
    userId: 'me'
  }).then(x => x.emailAddress);
};

/**
 * Helper function to fetch a user's OAuth 2.0 access token
 * Can fetch current tokens from Datastore, or create new ones
 */
exports.fetchToken = (emailAddress) => {
  return datastore.get(datastore.key(['oauth2Token', emailAddress]))
    .then((tokens) => {
      const token = tokens[0];

      // Check for new users
      if (!token) {
        throw new Error(config.UNKNOWN_USER_MESSAGE);
      }

      // Validate token
      if (!token.expiry_date || token.expiry_date < Date.now() + 60000) {
        oauth2Client.credentials.refresh_token =
          oauth2Client.credentials.refresh_token || token.refresh_token;
        return new Promise((resolve, reject) => { // Pify and oauth2client don't mix
          oauth2Client.refreshAccessToken((err, response) => {
            if (err) {
              return reject(err);
            }
            return resolve();
          });
        })
          .then(() => {
            return exports.saveToken(emailAddress);
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
exports.saveToken = (emailAddress) => {
  return datastore.save({
    key: datastore.key(['oauth2Token', emailAddress]),
    data: oauth2Client.credentials
  });
};
