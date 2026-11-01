import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_zh.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'gen/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations? of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations);
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('zh'),
  ];

  /// No description provided for @syncNow.
  ///
  /// In en, this message translates to:
  /// **'Sync now'**
  String get syncNow;

  /// No description provided for @dashboard.
  ///
  /// In en, this message translates to:
  /// **'Dashboard'**
  String get dashboard;

  /// No description provided for @leads.
  ///
  /// In en, this message translates to:
  /// **'Leads'**
  String get leads;

  /// No description provided for @shipping.
  ///
  /// In en, this message translates to:
  /// **'Shipping'**
  String get shipping;

  /// No description provided for @chat.
  ///
  /// In en, this message translates to:
  /// **'Chat'**
  String get chat;

  /// No description provided for @settings.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settings;

  /// No description provided for @clientApproval.
  ///
  /// In en, this message translates to:
  /// **'Client approval'**
  String get clientApproval;

  /// No description provided for @notesFromClient.
  ///
  /// In en, this message translates to:
  /// **'Notes from client'**
  String get notesFromClient;

  /// No description provided for @reject.
  ///
  /// In en, this message translates to:
  /// **'Reject'**
  String get reject;

  /// No description provided for @accept.
  ///
  /// In en, this message translates to:
  /// **'Accept'**
  String get accept;

  /// No description provided for @indiaChinaChat.
  ///
  /// In en, this message translates to:
  /// **'India ⇄ China chat'**
  String get indiaChinaChat;

  /// No description provided for @addYourChatwootAccessTokenIn.
  ///
  /// In en, this message translates to:
  /// **'Add your Chatwoot access token in Settings to use chat.'**
  String get addYourChatwootAccessTokenIn;

  /// No description provided for @retry.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get retry;

  /// No description provided for @message.
  ///
  /// In en, this message translates to:
  /// **'Message'**
  String get message;

  /// No description provided for @pipeline.
  ///
  /// In en, this message translates to:
  /// **'Pipeline'**
  String get pipeline;

  /// No description provided for @assignToChinaAgent.
  ///
  /// In en, this message translates to:
  /// **'Assign to China agent'**
  String get assignToChinaAgent;

  /// No description provided for @agentName.
  ///
  /// In en, this message translates to:
  /// **'Agent name'**
  String get agentName;

  /// No description provided for @cancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// No description provided for @assign.
  ///
  /// In en, this message translates to:
  /// **'Assign'**
  String get assign;

  /// No description provided for @winLossReason.
  ///
  /// In en, this message translates to:
  /// **'Win/loss reason'**
  String get winLossReason;

  /// No description provided for @closeLead.
  ///
  /// In en, this message translates to:
  /// **'Close lead'**
  String get closeLead;

  /// No description provided for @lead.
  ///
  /// In en, this message translates to:
  /// **'Lead'**
  String get lead;

  /// No description provided for @assignToChina.
  ///
  /// In en, this message translates to:
  /// **'Assign to China'**
  String get assignToChina;

  /// No description provided for @sourcingRequest.
  ///
  /// In en, this message translates to:
  /// **'Sourcing request'**
  String get sourcingRequest;

  /// No description provided for @closeWon.
  ///
  /// In en, this message translates to:
  /// **'Close won'**
  String get closeWon;

  /// No description provided for @closeLost.
  ///
  /// In en, this message translates to:
  /// **'Close lost'**
  String get closeLost;

  /// No description provided for @sourcingRequests.
  ///
  /// In en, this message translates to:
  /// **'Sourcing requests'**
  String get sourcingRequests;

  /// No description provided for @noneYet.
  ///
  /// In en, this message translates to:
  /// **'None yet'**
  String get noneYet;

  /// No description provided for @chatThread.
  ///
  /// In en, this message translates to:
  /// **'Chat thread'**
  String get chatThread;

  /// No description provided for @timeline.
  ///
  /// In en, this message translates to:
  /// **'Timeline'**
  String get timeline;

  /// No description provided for @newLead.
  ///
  /// In en, this message translates to:
  /// **'New lead'**
  String get newLead;

  /// No description provided for @clientName.
  ///
  /// In en, this message translates to:
  /// **'Client name *'**
  String get clientName;

  /// No description provided for @phone.
  ///
  /// In en, this message translates to:
  /// **'Phone'**
  String get phone;

  /// No description provided for @email.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get email;

  /// No description provided for @productInterest.
  ///
  /// In en, this message translates to:
  /// **'Product interest *'**
  String get productInterest;

  /// No description provided for @quantity.
  ///
  /// In en, this message translates to:
  /// **'Quantity'**
  String get quantity;

  /// No description provided for @targetPriceUnit.
  ///
  /// In en, this message translates to:
  /// **'Target price/unit'**
  String get targetPriceUnit;

  /// No description provided for @sourceChannel.
  ///
  /// In en, this message translates to:
  /// **'Source channel'**
  String get sourceChannel;

  /// No description provided for @saveLead.
  ///
  /// In en, this message translates to:
  /// **'Save lead'**
  String get saveLead;

  /// No description provided for @allStatuses.
  ///
  /// In en, this message translates to:
  /// **'All statuses'**
  String get allStatuses;

  /// No description provided for @noLeads.
  ///
  /// In en, this message translates to:
  /// **'No leads'**
  String get noLeads;

  /// No description provided for @sourceEasy.
  ///
  /// In en, this message translates to:
  /// **'Source Easy'**
  String get sourceEasy;

  /// No description provided for @indiaChinaSourcing.
  ///
  /// In en, this message translates to:
  /// **'India ⇄ China sourcing'**
  String get indiaChinaSourcing;

  /// No description provided for @password.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get password;

  /// No description provided for @sourceEasyServerURL.
  ///
  /// In en, this message translates to:
  /// **'Source Easy server URL'**
  String get sourceEasyServerURL;

  /// No description provided for @signIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get signIn;

  /// No description provided for @newQuotation.
  ///
  /// In en, this message translates to:
  /// **'New quotation'**
  String get newQuotation;

  /// No description provided for @supplier.
  ///
  /// In en, this message translates to:
  /// **'Supplier'**
  String get supplier;

  /// No description provided for @unitCost.
  ///
  /// In en, this message translates to:
  /// **'Unit cost'**
  String get unitCost;

  /// No description provided for @save.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get save;

  /// No description provided for @clientPricePerUnit.
  ///
  /// In en, this message translates to:
  /// **'Client price per unit'**
  String get clientPricePerUnit;

  /// No description provided for @setTheClientPriceFirst.
  ///
  /// In en, this message translates to:
  /// **'Set the client price first'**
  String get setTheClientPriceFirst;

  /// No description provided for @quotation.
  ///
  /// In en, this message translates to:
  /// **'Quotation'**
  String get quotation;

  /// No description provided for @amountsAreShownInTheCurrency.
  ///
  /// In en, this message translates to:
  /// **'Amounts are shown in the currency they were entered in. No conversion.'**
  String get amountsAreShownInTheCurrency;

  /// No description provided for @suppliers.
  ///
  /// In en, this message translates to:
  /// **'Suppliers'**
  String get suppliers;

  /// No description provided for @noQuotationsYet.
  ///
  /// In en, this message translates to:
  /// **'No quotations yet'**
  String get noQuotationsYet;

  /// No description provided for @clientPrice.
  ///
  /// In en, this message translates to:
  /// **'Client price'**
  String get clientPrice;

  /// No description provided for @pdfToWhatsApp.
  ///
  /// In en, this message translates to:
  /// **'PDF to WhatsApp'**
  String get pdfToWhatsApp;

  /// No description provided for @approval.
  ///
  /// In en, this message translates to:
  /// **'Approval'**
  String get approval;

  /// No description provided for @language.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get language;

  /// No description provided for @currencies.
  ///
  /// In en, this message translates to:
  /// **'Currencies'**
  String get currencies;

  /// No description provided for @usdRMBAndINREveryAmount.
  ///
  /// In en, this message translates to:
  /// **'USD, RMB and INR. Every amount stays in the currency it was entered in — no conversion.'**
  String get usdRMBAndINREveryAmount;

  /// No description provided for @offlineQueue.
  ///
  /// In en, this message translates to:
  /// **'Offline queue'**
  String get offlineQueue;

  /// No description provided for @chatwootConnection.
  ///
  /// In en, this message translates to:
  /// **'Chatwoot connection'**
  String get chatwootConnection;

  /// No description provided for @backups.
  ///
  /// In en, this message translates to:
  /// **'Backups'**
  String get backups;

  /// No description provided for @openTheBackupBrowserOnThe.
  ///
  /// In en, this message translates to:
  /// **'Open the backup browser on the storage server in a browser to download dumps. Restores are CLI-only.'**
  String get openTheBackupBrowserOnThe;

  /// No description provided for @signOut.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get signOut;

  /// No description provided for @chatwoot.
  ///
  /// In en, this message translates to:
  /// **'Chatwoot'**
  String get chatwoot;

  /// No description provided for @chatwootURL.
  ///
  /// In en, this message translates to:
  /// **'Chatwoot URL'**
  String get chatwootURL;

  /// No description provided for @accountID.
  ///
  /// In en, this message translates to:
  /// **'Account ID'**
  String get accountID;

  /// No description provided for @internalAPIInboxID.
  ///
  /// In en, this message translates to:
  /// **'Internal API inbox ID'**
  String get internalAPIInboxID;

  /// No description provided for @yourAccessToken.
  ///
  /// In en, this message translates to:
  /// **'Your access token'**
  String get yourAccessToken;

  /// No description provided for @chatwootProfileSettingsAccessToken.
  ///
  /// In en, this message translates to:
  /// **'Chatwoot → Profile settings → Access token'**
  String get chatwootProfileSettingsAccessToken;

  /// No description provided for @shippingTracker.
  ///
  /// In en, this message translates to:
  /// **'Shipping tracker'**
  String get shippingTracker;

  /// No description provided for @noShipmentsYet.
  ///
  /// In en, this message translates to:
  /// **'No shipments yet'**
  String get noShipmentsYet;

  /// No description provided for @updateShipment.
  ///
  /// In en, this message translates to:
  /// **'Update shipment'**
  String get updateShipment;

  /// No description provided for @forwarder.
  ///
  /// In en, this message translates to:
  /// **'Forwarder'**
  String get forwarder;

  /// No description provided for @trackingNumber.
  ///
  /// In en, this message translates to:
  /// **'Tracking number'**
  String get trackingNumber;

  /// No description provided for @currentLocation.
  ///
  /// In en, this message translates to:
  /// **'Current location'**
  String get currentLocation;

  /// No description provided for @latitude.
  ///
  /// In en, this message translates to:
  /// **'Latitude'**
  String get latitude;

  /// No description provided for @longitude.
  ///
  /// In en, this message translates to:
  /// **'Longitude'**
  String get longitude;

  /// No description provided for @saveUpdate.
  ///
  /// In en, this message translates to:
  /// **'Save update'**
  String get saveUpdate;

  /// No description provided for @productDescription.
  ///
  /// In en, this message translates to:
  /// **'Product description *'**
  String get productDescription;

  /// No description provided for @sampleStatus.
  ///
  /// In en, this message translates to:
  /// **'Sample status'**
  String get sampleStatus;

  /// No description provided for @supplierNamesOnePerLine.
  ///
  /// In en, this message translates to:
  /// **'Supplier names (one per line)'**
  String get supplierNamesOnePerLine;

  /// No description provided for @createRequest.
  ///
  /// In en, this message translates to:
  /// **'Create request'**
  String get createRequest;

  /// No description provided for @chinaAgent.
  ///
  /// In en, this message translates to:
  /// **'China agent'**
  String get chinaAgent;

  /// No description provided for @clientPriceUnit.
  ///
  /// In en, this message translates to:
  /// **'Client price/unit'**
  String get clientPriceUnit;

  /// No description provided for @clientTotal.
  ///
  /// In en, this message translates to:
  /// **'Client total'**
  String get clientTotal;

  /// No description provided for @contact.
  ///
  /// In en, this message translates to:
  /// **'Contact'**
  String get contact;

  /// No description provided for @container.
  ///
  /// In en, this message translates to:
  /// **'Container'**
  String get container;

  /// No description provided for @customs.
  ///
  /// In en, this message translates to:
  /// **'Customs'**
  String get customs;

  /// No description provided for @eta.
  ///
  /// In en, this message translates to:
  /// **'ETA'**
  String get eta;

  /// No description provided for @etd.
  ///
  /// In en, this message translates to:
  /// **'ETD'**
  String get etd;

  /// No description provided for @location.
  ///
  /// In en, this message translates to:
  /// **'Location'**
  String get location;

  /// No description provided for @office.
  ///
  /// In en, this message translates to:
  /// **'Office'**
  String get office;

  /// No description provided for @product.
  ///
  /// In en, this message translates to:
  /// **'Product'**
  String get product;

  /// No description provided for @source.
  ///
  /// In en, this message translates to:
  /// **'Source'**
  String get source;

  /// No description provided for @supplierCostUnit.
  ///
  /// In en, this message translates to:
  /// **'Supplier cost/unit'**
  String get supplierCostUnit;

  /// No description provided for @supplierTotal.
  ///
  /// In en, this message translates to:
  /// **'Supplier total'**
  String get supplierTotal;

  /// No description provided for @targetPrice.
  ///
  /// In en, this message translates to:
  /// **'Target price'**
  String get targetPrice;

  /// No description provided for @trackingNo.
  ///
  /// In en, this message translates to:
  /// **'Tracking no.'**
  String get trackingNo;

  /// No description provided for @validUntil.
  ///
  /// In en, this message translates to:
  /// **'Valid until'**
  String get validUntil;

  /// No description provided for @quotations.
  ///
  /// In en, this message translates to:
  /// **'Quotations'**
  String get quotations;

  /// No description provided for @offlineAndNothingCachedYet.
  ///
  /// In en, this message translates to:
  /// **'Offline and nothing cached yet'**
  String get offlineAndNothingCachedYet;

  /// No description provided for @noThreadYet.
  ///
  /// In en, this message translates to:
  /// **'No thread yet'**
  String get noThreadYet;

  /// No description provided for @notConfigured.
  ///
  /// In en, this message translates to:
  /// **'Not configured'**
  String get notConfigured;

  /// No description provided for @setDeadline.
  ///
  /// In en, this message translates to:
  /// **'Set deadline'**
  String get setDeadline;

  /// No description provided for @hideServer.
  ///
  /// In en, this message translates to:
  /// **'Hide server'**
  String get hideServer;

  /// No description provided for @serverSettings.
  ///
  /// In en, this message translates to:
  /// **'Server settings'**
  String get serverSettings;

  /// No description provided for @helloName.
  ///
  /// In en, this message translates to:
  /// **'Hello {name}'**
  String helloName(String name);

  /// No description provided for @pendingChanges.
  ///
  /// In en, this message translates to:
  /// **'{count} pending change(s)'**
  String pendingChanges(String count);

  /// No description provided for @offlineQueued.
  ///
  /// In en, this message translates to:
  /// **'Offline — changes are queued ({count} pending)'**
  String offlineQueued(String count);

  /// No description provided for @waitingToSync.
  ///
  /// In en, this message translates to:
  /// **'{count} change(s) waiting to sync'**
  String waitingToSync(String count);

  /// No description provided for @syncedSummary.
  ///
  /// In en, this message translates to:
  /// **'Synced {synced}, failed {failed}, remaining {remaining}'**
  String syncedSummary(String synced, String failed, String remaining);

  /// No description provided for @deadlineOn.
  ///
  /// In en, this message translates to:
  /// **'Deadline: {date}'**
  String deadlineOn(String date);

  /// No description provided for @qtyValidUntil.
  ///
  /// In en, this message translates to:
  /// **'Qty {qty} · valid until {date}'**
  String qtyValidUntil(String qty, String date);

  /// No description provided for @samplesStatus.
  ///
  /// In en, this message translates to:
  /// **'Samples: {status}'**
  String samplesStatus(String status);

  /// No description provided for @threadNo.
  ///
  /// In en, this message translates to:
  /// **'Thread #{id}'**
  String threadNo(String id);

  /// No description provided for @closeAsWon.
  ///
  /// In en, this message translates to:
  /// **'Close as won'**
  String get closeAsWon;

  /// No description provided for @closeAsLost.
  ///
  /// In en, this message translates to:
  /// **'Close as lost'**
  String get closeAsLost;

  /// No description provided for @required.
  ///
  /// In en, this message translates to:
  /// **'Required'**
  String get required;

  /// No description provided for @status.
  ///
  /// In en, this message translates to:
  /// **'Status'**
  String get status;

  /// No description provided for @forwarderTbd.
  ///
  /// In en, this message translates to:
  /// **'Forwarder TBD'**
  String get forwarderTbd;

  /// No description provided for @shipment.
  ///
  /// In en, this message translates to:
  /// **'Shipment'**
  String get shipment;

  /// No description provided for @notSent.
  ///
  /// In en, this message translates to:
  /// **'Not sent: {error}'**
  String notSent(String error);

  /// No description provided for @codeNew.
  ///
  /// In en, this message translates to:
  /// **'New'**
  String get codeNew;

  /// No description provided for @codeAssigned.
  ///
  /// In en, this message translates to:
  /// **'Assigned'**
  String get codeAssigned;

  /// No description provided for @codeSourcing.
  ///
  /// In en, this message translates to:
  /// **'Sourcing'**
  String get codeSourcing;

  /// No description provided for @codeQuoted.
  ///
  /// In en, this message translates to:
  /// **'Quoted'**
  String get codeQuoted;

  /// No description provided for @codeApproved.
  ///
  /// In en, this message translates to:
  /// **'Approved'**
  String get codeApproved;

  /// No description provided for @codeRejected.
  ///
  /// In en, this message translates to:
  /// **'Rejected'**
  String get codeRejected;

  /// No description provided for @codeShipping.
  ///
  /// In en, this message translates to:
  /// **'Shipping'**
  String get codeShipping;

  /// No description provided for @codeDelivered.
  ///
  /// In en, this message translates to:
  /// **'Delivered'**
  String get codeDelivered;

  /// No description provided for @codeWon.
  ///
  /// In en, this message translates to:
  /// **'Won'**
  String get codeWon;

  /// No description provided for @codeLost.
  ///
  /// In en, this message translates to:
  /// **'Lost'**
  String get codeLost;

  /// No description provided for @codeOpen.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get codeOpen;

  /// No description provided for @codePending.
  ///
  /// In en, this message translates to:
  /// **'Pending'**
  String get codePending;

  /// No description provided for @codeSent.
  ///
  /// In en, this message translates to:
  /// **'Sent'**
  String get codeSent;

  /// No description provided for @codeDraft.
  ///
  /// In en, this message translates to:
  /// **'Draft'**
  String get codeDraft;

  /// No description provided for @codeExpired.
  ///
  /// In en, this message translates to:
  /// **'Expired'**
  String get codeExpired;

  /// No description provided for @codeIndia.
  ///
  /// In en, this message translates to:
  /// **'India'**
  String get codeIndia;

  /// No description provided for @codeChina.
  ///
  /// In en, this message translates to:
  /// **'China'**
  String get codeChina;

  /// No description provided for @codeBoth.
  ///
  /// In en, this message translates to:
  /// **'Both'**
  String get codeBoth;

  /// No description provided for @codeNotRequested.
  ///
  /// In en, this message translates to:
  /// **'Not Requested'**
  String get codeNotRequested;

  /// No description provided for @codeRequested.
  ///
  /// In en, this message translates to:
  /// **'Requested'**
  String get codeRequested;

  /// No description provided for @codeReceived.
  ///
  /// In en, this message translates to:
  /// **'Received'**
  String get codeReceived;

  /// No description provided for @codeNotStarted.
  ///
  /// In en, this message translates to:
  /// **'Not Started'**
  String get codeNotStarted;

  /// No description provided for @codeFiled.
  ///
  /// In en, this message translates to:
  /// **'Filed'**
  String get codeFiled;

  /// No description provided for @codeCleared.
  ///
  /// In en, this message translates to:
  /// **'Cleared'**
  String get codeCleared;

  /// No description provided for @codeHeld.
  ///
  /// In en, this message translates to:
  /// **'Held'**
  String get codeHeld;

  /// No description provided for @codeBooked.
  ///
  /// In en, this message translates to:
  /// **'Booked'**
  String get codeBooked;

  /// No description provided for @codeInTransit.
  ///
  /// In en, this message translates to:
  /// **'In Transit'**
  String get codeInTransit;

  /// No description provided for @codeAtPort.
  ///
  /// In en, this message translates to:
  /// **'At Port'**
  String get codeAtPort;

  /// No description provided for @codeOutForDelivery.
  ///
  /// In en, this message translates to:
  /// **'Out For Delivery'**
  String get codeOutForDelivery;

  /// No description provided for @codeAir.
  ///
  /// In en, this message translates to:
  /// **'Air'**
  String get codeAir;

  /// No description provided for @codeLcl.
  ///
  /// In en, this message translates to:
  /// **'Lcl'**
  String get codeLcl;

  /// No description provided for @codeFcl.
  ///
  /// In en, this message translates to:
  /// **'Fcl'**
  String get codeFcl;

  /// No description provided for @codeFcl20.
  ///
  /// In en, this message translates to:
  /// **'Fcl 20'**
  String get codeFcl20;

  /// No description provided for @codeFcl40.
  ///
  /// In en, this message translates to:
  /// **'Fcl 40'**
  String get codeFcl40;

  /// No description provided for @codeCourier.
  ///
  /// In en, this message translates to:
  /// **'Courier'**
  String get codeCourier;

  /// No description provided for @codePhone.
  ///
  /// In en, this message translates to:
  /// **'Phone'**
  String get codePhone;

  /// No description provided for @codeWhatsapp.
  ///
  /// In en, this message translates to:
  /// **'Whatsapp'**
  String get codeWhatsapp;

  /// No description provided for @codeWebsite.
  ///
  /// In en, this message translates to:
  /// **'Website'**
  String get codeWebsite;

  /// No description provided for @codeReferral.
  ///
  /// In en, this message translates to:
  /// **'Referral'**
  String get codeReferral;

  /// No description provided for @codeWalkIn.
  ///
  /// In en, this message translates to:
  /// **'Walk In'**
  String get codeWalkIn;

  /// No description provided for @codeExhibition.
  ///
  /// In en, this message translates to:
  /// **'Exhibition'**
  String get codeExhibition;

  /// No description provided for @codeEmail.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get codeEmail;

  /// No description provided for @codeOther.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get codeOther;

  /// No description provided for @codeQuotation.
  ///
  /// In en, this message translates to:
  /// **'Quotation'**
  String get codeQuotation;

  /// No description provided for @codeIndiaStaff.
  ///
  /// In en, this message translates to:
  /// **'India Staff'**
  String get codeIndiaStaff;

  /// No description provided for @codeChinaStaff.
  ///
  /// In en, this message translates to:
  /// **'China Staff'**
  String get codeChinaStaff;

  /// No description provided for @codeIndiaAdmin.
  ///
  /// In en, this message translates to:
  /// **'India Admin'**
  String get codeIndiaAdmin;

  /// No description provided for @codeChinaAdmin.
  ///
  /// In en, this message translates to:
  /// **'China Admin'**
  String get codeChinaAdmin;

  /// No description provided for @codeSuperAdmin.
  ///
  /// In en, this message translates to:
  /// **'Super Admin'**
  String get codeSuperAdmin;

  /// No description provided for @client.
  ///
  /// In en, this message translates to:
  /// **'Client'**
  String get client;

  /// No description provided for @dateField.
  ///
  /// In en, this message translates to:
  /// **'{label}: {date}'**
  String dateField(String label, String date);

  /// No description provided for @savedOffline.
  ///
  /// In en, this message translates to:
  /// **'{what} saved offline — will sync when online'**
  String savedOffline(String what);

  /// No description provided for @savedOk.
  ///
  /// In en, this message translates to:
  /// **'{what} saved'**
  String savedOk(String what);

  /// No description provided for @assignment.
  ///
  /// In en, this message translates to:
  /// **'Assignment'**
  String get assignment;

  /// No description provided for @rejection.
  ///
  /// In en, this message translates to:
  /// **'Rejection'**
  String get rejection;

  /// No description provided for @languageTooltip.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get languageTooltip;

  /// No description provided for @loggedBy.
  ///
  /// In en, this message translates to:
  /// **'logged by {name}'**
  String loggedBy(String name);

  /// No description provided for @about.
  ///
  /// In en, this message translates to:
  /// **'About'**
  String get about;

  /// No description provided for @tlLeadCreated.
  ///
  /// In en, this message translates to:
  /// **'Lead created'**
  String get tlLeadCreated;

  /// No description provided for @tlOffice.
  ///
  /// In en, this message translates to:
  /// **'{office} office'**
  String tlOffice(String office);

  /// No description provided for @kpiActiveLeads.
  ///
  /// In en, this message translates to:
  /// **'Active leads'**
  String get kpiActiveLeads;

  /// No description provided for @kpiPendingSync.
  ///
  /// In en, this message translates to:
  /// **'Pending sync'**
  String get kpiPendingSync;

  /// No description provided for @attachments.
  ///
  /// In en, this message translates to:
  /// **'Photos & documents'**
  String get attachments;

  /// No description provided for @noAttachments.
  ///
  /// In en, this message translates to:
  /// **'No files attached'**
  String get noAttachments;

  /// No description provided for @deliveryCity.
  ///
  /// In en, this message translates to:
  /// **'Delivery city'**
  String get deliveryCity;

  /// No description provided for @referenceLink.
  ///
  /// In en, this message translates to:
  /// **'Reference link'**
  String get referenceLink;

  /// No description provided for @leadRef.
  ///
  /// In en, this message translates to:
  /// **'Reference'**
  String get leadRef;

  /// No description provided for @enquiryMessage.
  ///
  /// In en, this message translates to:
  /// **'Message'**
  String get enquiryMessage;

  /// No description provided for @contactPerson.
  ///
  /// In en, this message translates to:
  /// **'Contact person'**
  String get contactPerson;

  /// No description provided for @openFile.
  ///
  /// In en, this message translates to:
  /// **'Open / share'**
  String get openFile;

  /// No description provided for @searchRef.
  ///
  /// In en, this message translates to:
  /// **'Search reference, product…'**
  String get searchRef;

  /// No description provided for @updateAvailable.
  ///
  /// In en, this message translates to:
  /// **'Update available'**
  String get updateAvailable;

  /// No description provided for @updateRequired.
  ///
  /// In en, this message translates to:
  /// **'Update required'**
  String get updateRequired;

  /// No description provided for @updateRequiredHint.
  ///
  /// In en, this message translates to:
  /// **'This version is no longer supported. Please update to keep using Source Easy.'**
  String get updateRequiredHint;

  /// No description provided for @updateVersion.
  ///
  /// In en, this message translates to:
  /// **'Version {version} (build {build})'**
  String updateVersion(String version, String build);

  /// No description provided for @updateNotes.
  ///
  /// In en, this message translates to:
  /// **'What\'s new'**
  String get updateNotes;

  /// No description provided for @updateDownloading.
  ///
  /// In en, this message translates to:
  /// **'Downloading… {percent}%'**
  String updateDownloading(String percent);

  /// No description provided for @updateInstalling.
  ///
  /// In en, this message translates to:
  /// **'The installer has opened. Tap Install to finish.'**
  String get updateInstalling;

  /// No description provided for @updatePermissionTitle.
  ///
  /// In en, this message translates to:
  /// **'Allow installs from Source Easy'**
  String get updatePermissionTitle;

  /// No description provided for @updatePermissionSteps.
  ///
  /// In en, this message translates to:
  /// **'Android needs your permission once:\n1. Tap “Open settings”.\n2. Turn on “Allow from this source”.\n3. Come back and tap “Install”.'**
  String get updatePermissionSteps;

  /// No description provided for @updateOpenSettings.
  ///
  /// In en, this message translates to:
  /// **'Open settings'**
  String get updateOpenSettings;

  /// No description provided for @updateInstall.
  ///
  /// In en, this message translates to:
  /// **'Install'**
  String get updateInstall;

  /// No description provided for @updateNow.
  ///
  /// In en, this message translates to:
  /// **'Update now'**
  String get updateNow;

  /// No description provided for @updateLater.
  ///
  /// In en, this message translates to:
  /// **'Later'**
  String get updateLater;

  /// No description provided for @updateCheck.
  ///
  /// In en, this message translates to:
  /// **'Check for updates'**
  String get updateCheck;

  /// No description provided for @updateChecking.
  ///
  /// In en, this message translates to:
  /// **'Checking for updates…'**
  String get updateChecking;

  /// No description provided for @updateNone.
  ///
  /// In en, this message translates to:
  /// **'You have the latest version.'**
  String get updateNone;

  /// No description provided for @updateCheckFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t check for updates. Check your connection and try again.'**
  String get updateCheckFailed;

  /// No description provided for @updateDownloadFailed.
  ///
  /// In en, this message translates to:
  /// **'Download failed. Please try again.'**
  String get updateDownloadFailed;

  /// No description provided for @updateChecksumFailed.
  ///
  /// In en, this message translates to:
  /// **'The downloaded file is damaged (checksum mismatch). Please try again.'**
  String get updateChecksumFailed;

  /// No description provided for @updateInstalled.
  ///
  /// In en, this message translates to:
  /// **'Installed version {version} (build {build})'**
  String updateInstalled(String version, String build);

  /// No description provided for @summary.
  ///
  /// In en, this message translates to:
  /// **'Product summary'**
  String get summary;

  /// No description provided for @summaryHint.
  ///
  /// In en, this message translates to:
  /// **'Specs, material, size, colour, packaging, certifications…'**
  String get summaryHint;

  /// No description provided for @noSummary.
  ///
  /// In en, this message translates to:
  /// **'No summary yet'**
  String get noSummary;

  /// No description provided for @editSummary.
  ///
  /// In en, this message translates to:
  /// **'Edit summary'**
  String get editSummary;

  /// No description provided for @mediaTitle.
  ///
  /// In en, this message translates to:
  /// **'Product photos & videos'**
  String get mediaTitle;

  /// No description provided for @addPhotos.
  ///
  /// In en, this message translates to:
  /// **'Photos / videos'**
  String get addPhotos;

  /// No description provided for @takePhoto.
  ///
  /// In en, this message translates to:
  /// **'Take photo'**
  String get takePhoto;

  /// No description provided for @recordVideo.
  ///
  /// In en, this message translates to:
  /// **'Record video'**
  String get recordVideo;

  /// No description provided for @mediaHint.
  ///
  /// In en, this message translates to:
  /// **'Photos up to 10 MB, videos up to 100 MB, original quality'**
  String get mediaHint;

  /// No description provided for @uploadingFiles.
  ///
  /// In en, this message translates to:
  /// **'Uploading {count} files…'**
  String uploadingFiles(int count);

  /// No description provided for @uploadedFiles.
  ///
  /// In en, this message translates to:
  /// **'{count} files uploaded'**
  String uploadedFiles(int count);

  /// No description provided for @fileTooBig.
  ///
  /// In en, this message translates to:
  /// **'{name} is too large (photos 10 MB, videos 100 MB)'**
  String fileTooBig(String name);

  /// No description provided for @uploadNeedsOnline.
  ///
  /// In en, this message translates to:
  /// **'Lead saved offline. Add photos/videos once you are online.'**
  String get uploadNeedsOnline;

  /// No description provided for @deleteFileQ.
  ///
  /// In en, this message translates to:
  /// **'Delete {name}?'**
  String deleteFileQ(String name);

  /// No description provided for @delete.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get delete;

  /// No description provided for @playVideo.
  ///
  /// In en, this message translates to:
  /// **'Play video'**
  String get playVideo;

  /// No description provided for @agentOptional.
  ///
  /// In en, this message translates to:
  /// **'China agent (optional)'**
  String get agentOptional;

  /// No description provided for @assignedToChina.
  ///
  /// In en, this message translates to:
  /// **'Assigned to the China office'**
  String get assignedToChina;

  /// No description provided for @notifications.
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get notifications;

  /// No description provided for @noNotifications.
  ///
  /// In en, this message translates to:
  /// **'No notifications yet'**
  String get noNotifications;

  /// No description provided for @markAllRead.
  ///
  /// In en, this message translates to:
  /// **'Mark all read'**
  String get markAllRead;

  /// No description provided for @notifAssigned.
  ///
  /// In en, this message translates to:
  /// **'{ref} · {product} assigned to you{by}'**
  String notifAssigned(String ref, String product, String by);

  /// No description provided for @notifReturned.
  ///
  /// In en, this message translates to:
  /// **'{ref} · {product} returned to you{by}'**
  String notifReturned(String ref, String product, String by);

  /// No description provided for @notifQueue.
  ///
  /// In en, this message translates to:
  /// **'{ref} · {product} is waiting in the {office} queue{by}'**
  String notifQueue(String ref, String product, String office, String by);

  /// No description provided for @notifBy.
  ///
  /// In en, this message translates to:
  /// **' by {name}'**
  String notifBy(String name);

  /// No description provided for @assignedToMe.
  ///
  /// In en, this message translates to:
  /// **'Assigned to me'**
  String get assignedToMe;

  /// No description provided for @noneAssignedToMe.
  ///
  /// In en, this message translates to:
  /// **'Nothing is assigned to you'**
  String get noneAssignedToMe;

  /// No description provided for @raisedBy.
  ///
  /// In en, this message translates to:
  /// **'Raised by'**
  String get raisedBy;

  /// No description provided for @assignedTo.
  ///
  /// In en, this message translates to:
  /// **'Assigned to'**
  String get assignedTo;

  /// No description provided for @officeQueue.
  ///
  /// In en, this message translates to:
  /// **'{office} queue (unassigned)'**
  String officeQueue(String office);

  /// No description provided for @sendToChina.
  ///
  /// In en, this message translates to:
  /// **'Send to China'**
  String get sendToChina;

  /// No description provided for @returnToIndia.
  ///
  /// In en, this message translates to:
  /// **'Return to India'**
  String get returnToIndia;

  /// No description provided for @reassign.
  ///
  /// In en, this message translates to:
  /// **'Reassign'**
  String get reassign;

  /// No description provided for @teamMember.
  ///
  /// In en, this message translates to:
  /// **'Team member'**
  String get teamMember;

  /// No description provided for @raiserDefault.
  ///
  /// In en, this message translates to:
  /// **'{name} (raised it — default)'**
  String raiserDefault(String name);

  /// No description provided for @handedTo.
  ///
  /// In en, this message translates to:
  /// **'Handed to {who}'**
  String handedTo(String who);

  /// No description provided for @newLeadNotif.
  ///
  /// In en, this message translates to:
  /// **'Source Easy lead'**
  String get newLeadNotif;

  /// No description provided for @lqTitle.
  ///
  /// In en, this message translates to:
  /// **'Supplier quotes'**
  String get lqTitle;

  /// No description provided for @lqAdd.
  ///
  /// In en, this message translates to:
  /// **'Add quote'**
  String get lqAdd;

  /// No description provided for @lqEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit'**
  String get lqEdit;

  /// No description provided for @lqNone.
  ///
  /// In en, this message translates to:
  /// **'No supplier quotes yet. China will add them here.'**
  String get lqNone;

  /// No description provided for @lqNoneChina.
  ///
  /// In en, this message translates to:
  /// **'No quotes yet. Add the supplier\'s price, MOQ and product photos.'**
  String get lqNoneChina;

  /// No description provided for @lqLoadFail.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load quotes.'**
  String get lqLoadFail;

  /// No description provided for @lqUnit.
  ///
  /// In en, this message translates to:
  /// **'unit'**
  String get lqUnit;

  /// No description provided for @lqMoq.
  ///
  /// In en, this message translates to:
  /// **'MOQ'**
  String get lqMoq;

  /// No description provided for @lqLeadTime.
  ///
  /// In en, this message translates to:
  /// **'Lead time'**
  String get lqLeadTime;

  /// No description provided for @lqValidity.
  ///
  /// In en, this message translates to:
  /// **'Valid for'**
  String get lqValidity;

  /// No description provided for @lqNotes.
  ///
  /// In en, this message translates to:
  /// **'Notes'**
  String get lqNotes;

  /// No description provided for @lqSupplier.
  ///
  /// In en, this message translates to:
  /// **'Supplier'**
  String get lqSupplier;

  /// No description provided for @lqChinaOnly.
  ///
  /// In en, this message translates to:
  /// **'China only'**
  String get lqChinaOnly;

  /// No description provided for @lqNoSupplier.
  ///
  /// In en, this message translates to:
  /// **'— Select supplier —'**
  String get lqNoSupplier;

  /// No description provided for @lqNewSupplier.
  ///
  /// In en, this message translates to:
  /// **'New supplier'**
  String get lqNewSupplier;

  /// No description provided for @lqSupName.
  ///
  /// In en, this message translates to:
  /// **'Supplier name'**
  String get lqSupName;

  /// No description provided for @lqSupContact.
  ///
  /// In en, this message translates to:
  /// **'Contact person'**
  String get lqSupContact;

  /// No description provided for @lqSupPhone.
  ///
  /// In en, this message translates to:
  /// **'Phone'**
  String get lqSupPhone;

  /// No description provided for @lqSupCity.
  ///
  /// In en, this message translates to:
  /// **'City'**
  String get lqSupCity;

  /// No description provided for @lqProduct.
  ///
  /// In en, this message translates to:
  /// **'Product / model'**
  String get lqProduct;

  /// No description provided for @lqProductPh.
  ///
  /// In en, this message translates to:
  /// **'e.g. SB-500 steel bottle 500ml'**
  String get lqProductPh;

  /// No description provided for @lqUnitPrice.
  ///
  /// In en, this message translates to:
  /// **'Unit price'**
  String get lqUnitPrice;

  /// No description provided for @lqCurrency.
  ///
  /// In en, this message translates to:
  /// **'Currency'**
  String get lqCurrency;

  /// No description provided for @lqMedia.
  ///
  /// In en, this message translates to:
  /// **'Supplier photos, videos & documents'**
  String get lqMedia;

  /// No description provided for @lqAddMedia.
  ///
  /// In en, this message translates to:
  /// **'Add photos / files'**
  String get lqAddMedia;

  /// No description provided for @lqSellPrice.
  ///
  /// In en, this message translates to:
  /// **'Our selling price'**
  String get lqSellPrice;

  /// No description provided for @lqSellNotes.
  ///
  /// In en, this message translates to:
  /// **'Customer quote notes'**
  String get lqSellNotes;

  /// No description provided for @lqAddSell.
  ///
  /// In en, this message translates to:
  /// **'Add INR price'**
  String get lqAddSell;

  /// No description provided for @lqReturnHint.
  ///
  /// In en, this message translates to:
  /// **'Done quoting? Tap “Return to India” to notify the person who raised this lead.'**
  String get lqReturnHint;

  /// No description provided for @lqErrProduct.
  ///
  /// In en, this message translates to:
  /// **'Enter the product / model.'**
  String get lqErrProduct;

  /// No description provided for @lqErrPrice.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid unit price.'**
  String get lqErrPrice;

  /// No description provided for @lqErrSupplier.
  ///
  /// In en, this message translates to:
  /// **'Enter the new supplier\'s name.'**
  String get lqErrSupplier;

  /// No description provided for @lqDeleteQ.
  ///
  /// In en, this message translates to:
  /// **'Delete the quote for “{product}”?'**
  String lqDeleteQ(String product);

  /// No description provided for @lqBy.
  ///
  /// In en, this message translates to:
  /// **'Added by {name}'**
  String lqBy(String name);

  /// No description provided for @quotesTab.
  ///
  /// In en, this message translates to:
  /// **'Quotes'**
  String get quotesTab;

  /// No description provided for @ordersTab.
  ///
  /// In en, this message translates to:
  /// **'Orders'**
  String get ordersTab;

  /// No description provided for @more.
  ///
  /// In en, this message translates to:
  /// **'More'**
  String get more;

  /// No description provided for @qlTitle.
  ///
  /// In en, this message translates to:
  /// **'All quotes'**
  String get qlTitle;

  /// No description provided for @qlNone.
  ///
  /// In en, this message translates to:
  /// **'No quotes yet'**
  String get qlNone;

  /// No description provided for @qlMine.
  ///
  /// In en, this message translates to:
  /// **'Assigned to me'**
  String get qlMine;

  /// No description provided for @qlAll.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get qlAll;

  /// No description provided for @shipTitle.
  ///
  /// In en, this message translates to:
  /// **'Shipping'**
  String get shipTitle;

  /// No description provided for @shipCost.
  ///
  /// In en, this message translates to:
  /// **'Shipping cost'**
  String get shipCost;

  /// No description provided for @shipCostInr.
  ///
  /// In en, this message translates to:
  /// **'Shipping (₹ INR)'**
  String get shipCostInr;

  /// No description provided for @shipTerm.
  ///
  /// In en, this message translates to:
  /// **'Incoterm'**
  String get shipTerm;

  /// No description provided for @shipMode.
  ///
  /// In en, this message translates to:
  /// **'Mode'**
  String get shipMode;

  /// No description provided for @shipPort.
  ///
  /// In en, this message translates to:
  /// **'Port / destination'**
  String get shipPort;

  /// No description provided for @shipTransit.
  ///
  /// In en, this message translates to:
  /// **'Transit time'**
  String get shipTransit;

  /// No description provided for @shipNone.
  ///
  /// In en, this message translates to:
  /// **'—'**
  String get shipNone;

  /// No description provided for @qsDRAFT.
  ///
  /// In en, this message translates to:
  /// **'Draft'**
  String get qsDRAFT;

  /// No description provided for @qsSENT.
  ///
  /// In en, this message translates to:
  /// **'Sent'**
  String get qsSENT;

  /// No description provided for @qsACCEPTED.
  ///
  /// In en, this message translates to:
  /// **'Accepted'**
  String get qsACCEPTED;

  /// No description provided for @qsREJECTED.
  ///
  /// In en, this message translates to:
  /// **'Rejected'**
  String get qsREJECTED;

  /// No description provided for @cqPrepare.
  ///
  /// In en, this message translates to:
  /// **'Prepare customer quote'**
  String get cqPrepare;

  /// No description provided for @cqTitle.
  ///
  /// In en, this message translates to:
  /// **'Customer quote'**
  String get cqTitle;

  /// No description provided for @cqUnit.
  ///
  /// In en, this message translates to:
  /// **'Price per unit (₹ INR)'**
  String get cqUnit;

  /// No description provided for @cqQty.
  ///
  /// In en, this message translates to:
  /// **'Quantity'**
  String get cqQty;

  /// No description provided for @cqGst.
  ///
  /// In en, this message translates to:
  /// **'GST %'**
  String get cqGst;

  /// No description provided for @cqOther.
  ///
  /// In en, this message translates to:
  /// **'Other charges (₹)'**
  String get cqOther;

  /// No description provided for @cqOtherLabel.
  ///
  /// In en, this message translates to:
  /// **'Other charges label'**
  String get cqOtherLabel;

  /// No description provided for @cqValidity.
  ///
  /// In en, this message translates to:
  /// **'Valid for'**
  String get cqValidity;

  /// No description provided for @cqTerms.
  ///
  /// In en, this message translates to:
  /// **'Terms'**
  String get cqTerms;

  /// No description provided for @cqSubtotal.
  ///
  /// In en, this message translates to:
  /// **'Product subtotal'**
  String get cqSubtotal;

  /// No description provided for @cqGstAmt.
  ///
  /// In en, this message translates to:
  /// **'GST'**
  String get cqGstAmt;

  /// No description provided for @cqTotal.
  ///
  /// In en, this message translates to:
  /// **'Total'**
  String get cqTotal;

  /// No description provided for @cqSavePreview.
  ///
  /// In en, this message translates to:
  /// **'Save & preview'**
  String get cqSavePreview;

  /// No description provided for @cqGenerate.
  ///
  /// In en, this message translates to:
  /// **'Generate PDF'**
  String get cqGenerate;

  /// No description provided for @cqDownload.
  ///
  /// In en, this message translates to:
  /// **'Open PDF'**
  String get cqDownload;

  /// No description provided for @cqWhatsapp.
  ///
  /// In en, this message translates to:
  /// **'WhatsApp'**
  String get cqWhatsapp;

  /// No description provided for @cqEmail.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get cqEmail;

  /// No description provided for @cqShare.
  ///
  /// In en, this message translates to:
  /// **'Share'**
  String get cqShare;

  /// No description provided for @cqMarkSent.
  ///
  /// In en, this message translates to:
  /// **'Mark sent'**
  String get cqMarkSent;

  /// No description provided for @cqAccept.
  ///
  /// In en, this message translates to:
  /// **'Customer accepted'**
  String get cqAccept;

  /// No description provided for @cqReject.
  ///
  /// In en, this message translates to:
  /// **'Customer rejected'**
  String get cqReject;

  /// No description provided for @cqReason.
  ///
  /// In en, this message translates to:
  /// **'Reason (required)'**
  String get cqReason;

  /// No description provided for @cqCreateOrder.
  ///
  /// In en, this message translates to:
  /// **'Create order'**
  String get cqCreateOrder;

  /// No description provided for @cqOrderCreated.
  ///
  /// In en, this message translates to:
  /// **'Order created'**
  String get cqOrderCreated;

  /// No description provided for @cqErr.
  ///
  /// In en, this message translates to:
  /// **'Enter quantity and price'**
  String get cqErr;

  /// No description provided for @orTitle.
  ///
  /// In en, this message translates to:
  /// **'Orders'**
  String get orTitle;

  /// No description provided for @orNone.
  ///
  /// In en, this message translates to:
  /// **'No orders yet'**
  String get orNone;

  /// No description provided for @orProduction.
  ///
  /// In en, this message translates to:
  /// **'Production'**
  String get orProduction;

  /// No description provided for @orShipment.
  ///
  /// In en, this message translates to:
  /// **'Shipment (India)'**
  String get orShipment;

  /// No description provided for @orPayment.
  ///
  /// In en, this message translates to:
  /// **'Payment'**
  String get orPayment;

  /// No description provided for @orAdvance.
  ///
  /// In en, this message translates to:
  /// **'Advance (₹)'**
  String get orAdvance;

  /// No description provided for @orTracking.
  ///
  /// In en, this message translates to:
  /// **'Tracking no.'**
  String get orTracking;

  /// No description provided for @orContainer.
  ///
  /// In en, this message translates to:
  /// **'Container no.'**
  String get orContainer;

  /// No description provided for @orEtd.
  ///
  /// In en, this message translates to:
  /// **'ETD (YYYY-MM-DD)'**
  String get orEtd;

  /// No description provided for @orEta.
  ///
  /// In en, this message translates to:
  /// **'ETA (YYYY-MM-DD)'**
  String get orEta;

  /// No description provided for @orExpectedShip.
  ///
  /// In en, this message translates to:
  /// **'Expected ship (YYYY-MM-DD)'**
  String get orExpectedShip;

  /// No description provided for @orCustomer.
  ///
  /// In en, this message translates to:
  /// **'Customer'**
  String get orCustomer;

  /// No description provided for @orSupplier.
  ///
  /// In en, this message translates to:
  /// **'Supplier'**
  String get orSupplier;

  /// No description provided for @orCost.
  ///
  /// In en, this message translates to:
  /// **'China cost'**
  String get orCost;

  /// No description provided for @orTotal.
  ///
  /// In en, this message translates to:
  /// **'Order value'**
  String get orTotal;

  /// No description provided for @orSaved.
  ///
  /// In en, this message translates to:
  /// **'Saved'**
  String get orSaved;

  /// No description provided for @notifQuoteAccepted.
  ///
  /// In en, this message translates to:
  /// **'{ref} · {product}: customer accepted the quote{by}'**
  String notifQuoteAccepted(String ref, String product, String by);

  /// No description provided for @notifQuoteRejected.
  ///
  /// In en, this message translates to:
  /// **'{ref} · {product}: customer rejected the quote{by}'**
  String notifQuoteRejected(String ref, String product, String by);

  /// No description provided for @notifOrderNew.
  ///
  /// In en, this message translates to:
  /// **'{ref} · {product}: new order{by}'**
  String notifOrderNew(String ref, String product, String by);

  /// No description provided for @notifOrderUpdate.
  ///
  /// In en, this message translates to:
  /// **'{ref} · {product}: order updated{by}'**
  String notifOrderUpdate(String ref, String product, String by);

  /// No description provided for @prodNew.
  ///
  /// In en, this message translates to:
  /// **'New'**
  String get prodNew;

  /// No description provided for @prodDepositPaid.
  ///
  /// In en, this message translates to:
  /// **'Deposit paid'**
  String get prodDepositPaid;

  /// No description provided for @prodInProduction.
  ///
  /// In en, this message translates to:
  /// **'In production'**
  String get prodInProduction;

  /// No description provided for @prodReady.
  ///
  /// In en, this message translates to:
  /// **'Ready'**
  String get prodReady;

  /// No description provided for @prodShipped.
  ///
  /// In en, this message translates to:
  /// **'Shipped'**
  String get prodShipped;

  /// No description provided for @indNone.
  ///
  /// In en, this message translates to:
  /// **'Not shipped'**
  String get indNone;

  /// No description provided for @indInTransit.
  ///
  /// In en, this message translates to:
  /// **'In transit'**
  String get indInTransit;

  /// No description provided for @indCustoms.
  ///
  /// In en, this message translates to:
  /// **'At customs'**
  String get indCustoms;

  /// No description provided for @indDelivered.
  ///
  /// In en, this message translates to:
  /// **'Delivered'**
  String get indDelivered;

  /// No description provided for @payPending.
  ///
  /// In en, this message translates to:
  /// **'Pending'**
  String get payPending;

  /// No description provided for @payPartial.
  ///
  /// In en, this message translates to:
  /// **'Partly paid'**
  String get payPartial;

  /// No description provided for @payPaid.
  ///
  /// In en, this message translates to:
  /// **'Paid'**
  String get payPaid;

  /// No description provided for @termExw.
  ///
  /// In en, this message translates to:
  /// **'EXW'**
  String get termExw;

  /// No description provided for @termFob.
  ///
  /// In en, this message translates to:
  /// **'FOB'**
  String get termFob;

  /// No description provided for @termCif.
  ///
  /// In en, this message translates to:
  /// **'CIF'**
  String get termCif;

  /// No description provided for @termCfr.
  ///
  /// In en, this message translates to:
  /// **'CFR'**
  String get termCfr;

  /// No description provided for @termDdp.
  ///
  /// In en, this message translates to:
  /// **'DDP'**
  String get termDdp;

  /// No description provided for @termDap.
  ///
  /// In en, this message translates to:
  /// **'DAP'**
  String get termDap;

  /// No description provided for @termDoor.
  ///
  /// In en, this message translates to:
  /// **'Door to door'**
  String get termDoor;

  /// No description provided for @modeAir.
  ///
  /// In en, this message translates to:
  /// **'Air'**
  String get modeAir;

  /// No description provided for @modeSea.
  ///
  /// In en, this message translates to:
  /// **'Sea'**
  String get modeSea;

  /// No description provided for @modeExpress.
  ///
  /// In en, this message translates to:
  /// **'Express / courier'**
  String get modeExpress;

  /// No description provided for @modeRoad.
  ///
  /// In en, this message translates to:
  /// **'Road'**
  String get modeRoad;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'zh'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'zh':
      return AppLocalizationsZh();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
