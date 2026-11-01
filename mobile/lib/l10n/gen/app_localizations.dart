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
