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

// Configuration constants
// TODO(developer): update these values
const GCF_REGION = 'YOUR_GCF_REGION';
const GCLOUD_PROJECT = 'YOUR_GCLOUD_PROJECT_ID';
const TOPIC_ID = 'YOUR_PUBSUB_TOPIC';

// Computed values
exports = {
  GCF_BASE_URL: `https://${GCF_REGION}-${GCLOUD_PROJECT}.cloudfunctions.net`,
  TOPIC_NAME: `projects/${GCLOUD_PROJECT}/topics/${TOPIC_ID}`,
  GCF_REGION: GCF_REGION
};

// Constants
exports.NO_LABEL_MATCH = `Message doesn't match label`;
exports.UNKNOWN_USER_MESSAGE = 'Uninitialized email address';
