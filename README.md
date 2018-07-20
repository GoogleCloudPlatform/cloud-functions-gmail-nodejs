# Gmail + GCF intelligence demo

This repository demonstrates how to write custom mail processing logic for Gmail using the [Gmail API][gmail] and [Cloud Functions][gcf]

## Obtaining an OAuth 2.0 Client ID
In order for an OAuth 2.0 API to verify our program's identity, we must include
an _OAuth 2.0 client ID_ with some of our requests to the API. The following
steps show how to enable the Gmail API and download the client ID to your local
machine.

1.  Enable the Gmail API by [visiting the _Enable an API_ page in the GCP Console][console_gmail]
    (under **APIs** > **Enable APIs and Services**) and selecting the appropriate
    GCP Project.
1.  Find the [GCP region][docs_regions] you want to deploy your function to.
    (In general, response time is quickest for the regions closest to you.) For
    the rest of this tutorial, replace `[YOUR_GCF_REGION]` with your selected
    region's name (for example, `us-central1`).
1.  Generate a new OAuth 2.0 client ID by [visiting the GCP Console credentials page][console_credentials].
    Configure the fields as indicated below:

    - Application type: `Web application`
    - Name: an appropriate, memorable name for your client
    - Authorized JavaScript origins: `https://[YOUR_GCF_REGION]-[YOUR_GCP_PROJECT_ID].cloudfunctions.net/oauth2callback`

1.  Click _Create_, then close the resulting dialog box and click the
    **Download** icon next to your newly created client ID. The resulting file
    is your __Client Secret file__.

## Configuring local files
1.    Rename your __Client Secret file__ to `client_secret.json`, and move it to
    the directory that contains your `index.js` and `package.json` files.
1.    In `config.json`, update the values for `GCF_REGION`, `GCLOUD_PROJECT`,
    and `TOPIC_ID`.

[docs_regions]: http://cloud.google.com/functions/docs/locations
[console_gmail]: http://console.cloud.google.com/flows/enableApi?apiid=gmail.googleapis.com
[console_credentials]: https://console.cloud.google.com/apis/credentials
[gmail]: https://developers.google.com/gmail/api
[gcf]: https://cloud.google.com/functions
