+-----------------------------------------------------------------------+
| **TWOFER**                                                            |
|                                                                       |
| **Developer handoff and page-by-page build map**                      |
|                                                                       |
| Updated with founder decisions and billing direction                  |
+=======================================================================+
+-----------------------------------------------------------------------+

Prepared for a new developer so they can quickly understand what Twofer
is, what appears to already exist, what still needs to be finished, and
how each screen and workflow should behave.

+-----------------------+-----------------------+-----------------------+
| **Product**           | **Founder**           | **Date updated**      |
|                       |                       |                       |
| Twofer                | Dan Sanders           | March 30, 2026        |
+=======================+=======================+=======================+
| **Launch focus**      | **Audience**          | **Purpose**           |
|                       |                       |                       |
| Dallas area coffee    | New developer /       | Single handoff for    |
| shops, bakeries, and  | engineering lead      | product, flows, and   |
| cafes                 |                       | launch priorities     |
+-----------------------+-----------------------+-----------------------+

  -----------------------------------------------------------------------
  **Read this first.** Twofer is not just a coupon app. It is an AI-first
  local demand activation app. The business side has to feel almost
  frictionless. The right build standard is less typing, fewer taps, more
  guided AI help, fast publishing, and fast redemption.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

1\. Product summary

Twofer helps local businesses fill slow hours with controlled,
limited-time offers and helps consumers discover those offers in real
time. The initial target is independent coffee shops, bakeries, and
cafes in the Dallas area. The product is two-sided. Businesses create
and manage offers. Consumers discover, claim, and redeem them.

The business thesis is consistent across the strategy materials. Twofer
is meant to solve predictable slow periods, especially weekday off-peak
windows, with a narrow local launch, strong AI assistance, and a simple
redemption path. The consumer experience should feel local, timely, and
easy. The business experience should feel fast enough that an owner can
build and launch a deal in under a minute once their profile and menu
are set up.

Non-negotiable positioning

  -----------------------------------------------------------------------
  **Point**                      **Direction**
  ------------------------------ ----------------------------------------
  **Primary launch niche**       Dallas coffee shops, bakeries, and
                                 cafes.

  **Core promise to businesses** Bring new nearby customers in during
                                 slow periods with meaningful offers and
                                 minimal setup time.

  **Core promise to consumers**  Show nearby and favorite businesses with
                                 live deals and make redemption simple.

  **Product angle**              AI-forward, local, time-sensitive,
                                 quantity-limited, and operationally
                                 simple.

  **Why AI matters**             AI is not a side feature. It should
                                 reduce typing, speed setup, help
                                 structure deals, and make menu-based
                                 offer creation easy.
  -----------------------------------------------------------------------

2\. Founder decisions now resolved

These decisions were still open in prior discussions. They are now
resolved and should be treated as current founder direction unless Dan
changes them later.

  -----------------------------------------------------------------------
  **Decision area**       **Resolved direction**  **Implementation note**
  ----------------------- ----------------------- -----------------------
  Mode selection          Users choose business   Auth entry should
                          vs consumer mode at     clearly route users to
                          login.                  the correct experience
                                                  before they reach the
                                                  main app.

  Guest access            No open browsing        Anonymous browsing
                          without an account.     should be removed. A
                                                  demo account can still
                                                  exist, but it is a
                                                  credentialed
                                                  experience, not guest
                                                  mode.

  Business onboarding     Capture enough          At minimum the profile
                          public-facing           has to support
                          information so          discovery, navigation,
                          customers can easily    and confidence at
                          find the business when  pickup.
                          redeeming a deal.       

  MVP analytics           Track impressions,      Scheduling and
                          clicks or opens,        recurring deals are
                          claims, redemption when launch features, not
                          technically possible,   optional analytics.
                          time-window             
                          performance, and repeat 
                          offer performance.      

  Billing timing          Billing should be built Stripe test mode and
                          before launch.          the billing flow need
                                                  to be working before
                                                  the pilot converts to
                                                  paid.

  Map direction           Use a live map. Show    Use a strong visual
                          all businesses with a   state for live deals
                          Twofer account. Make    such as a pulsing blue
                          live deals stand out    halo or animated glow
                          clearly.                if performance allows.
  -----------------------------------------------------------------------

3\. Current state of the app

The items below are based on prior development chats and project
materials. They should be treated as a starting point for a code audit,
not as guaranteed production truth. A new developer should verify each
item against the actual repo, Supabase project, and build behavior.

  ------------------------------------------------------------------------
  **Area**              **Likely status**      **Notes for audit**
  --------------------- ---------------------- ---------------------------
  App shell and routes  Exists                 Expo React Native app with
                                               split consumer and business
                                               flows, tabs, onboarding,
                                               and detail screens appears
                                               to exist.

  Auth and Supabase     Exists, needs audit    Supabase auth is wired.
                                               Login, sign up, forgot
                                               password, demo auth, and
                                               error handling have been
                                               discussed and partially
                                               fixed.

  Consumer onboarding   Exists, needs polish   GPS or ZIP flow, radius
                                               selection, and
                                               notifications appear to
                                               exist. Reliability and copy
                                               should be checked.

  Map                   Exists, needs          Map has existed but has
                        reliability pass       also crashed in testing. It
                                               must be stable before
                                               launch.

  Wallet and claims     Exists, needs          Claiming, QR token, and
                        verification           visual redemption fallback
                                               have been built
                                               conceptually and at least
                                               partially implemented.

  Business offer        Partial                Business-side offer
  creation                                     creation exists in some
                                               form, but the menu-driven
                                               AI-first builder is not
                                               finished.

  AI functions          Partial to strong      Multiple AI edge functions
                        backend foundation     appear to exist for
                                               composing offer copy and ad
                                               variants. Product
                                               integration still needs
                                               tightening.

  Localization          Exists                 English, Spanish, and
                                               Korean support appears to
                                               be wired at the app level.

  Demo business         Exists or partially    Founder wants a realistic
  experience            exists                 demo account with sample
                                               business data and sample
                                               deals.

  Billing               Detailed handoff       Billing direction is now
                        exists, implementation defined and should be
                        pending                merged into the core launch
                                               plan.
  ------------------------------------------------------------------------

4\. Core business rules and product guardrails

-   Consumers should not browse deals without an account.

-   Consumers should only have one active claim at a time app-wide.

-   There should also be a one-claim-per-business-per-day rule unless
    founder direction changes later.

-   Wallet entries should expire when the deal window ends. A visible
    countdown is important.

-   Redemption should be fast. QR is preferred. Visual fallback should
    exist when scanning is not practical.

-   Deals should be meaningful. Keep the strong-deal guardrail. Weak
    discounts should not get through.

-   Businesses should control start time, end time, quantity, and
    location for each offer.

-   Scheduling and recurring deals are required for launch because
    businesses will want repeat weekday patterns.

5\. AI-first business experience

This is one of the clearest founder priorities. Twofer should feel like
an AI-first tool for businesses, not a normal form-heavy dashboard with
an AI button added later. The business owner should be able to set up
their menu, select items, generate strong offer options, and publish
quickly with almost no typing.

Menu capture requirements

  -----------------------------------------------------------------------
  **Requirement**                **Direction**
  ------------------------------ ----------------------------------------
  **Capture source**             Business should be able to upload a
                                 single menu photo, multiple menu photos,
                                 or a close-up item photo.

  **AI extraction**              AI should extract menu items into a
                                 structured list the business can review,
                                 edit lightly, save, and reuse later.

  **Stored menu library**        Menu items should live in the business
                                 profile so they can be selected quickly
                                 during deal creation.

  **Low typing goal**            The experience should favor dropdowns,
                                 suggested values, toggles, and
                                 AI-generated defaults over manual entry.

  **Human correction**           Owners should be able to fix item names,
                                 sizes, descriptions, or categories if AI
                                 extraction is imperfect.

  **Reusability**                Once menu items are stored, they should
                                 be available for recurring and future
                                 deals without retyping.
  -----------------------------------------------------------------------

Preferred deal builder behavior

The founder\'s preferred mental model is menu-first. The owner should be
able to go down a saved menu list and build a deal with very little
typing. Example flows:

-   Buy item X, get item Y free. Select the paid item first, then select
    the free item from the same saved menu list.

-   Discount item. Select one item, then choose a discount type such as
    percent off or fixed-price special.

-   Simple BOGO. Select one menu item and duplicate it as the matching
    free or discounted item if the offer is for the same item.

-   Suggested variants. After the owner chooses the item or item pair,
    AI should generate at least three strong ad variants with clear
    value language.

-   Light edit through chat. The owner should be able to fine-tune the
    ad through AI chat instead of editing a long form manually.

Definition of success for the business flow

After a business finishes onboarding and confirms its menu, the typical
path to create a new deal should be under one minute. The owner should
not need to manually type item names each time, manually rebuild common
weekday deals, or learn a complex dashboard just to launch a simple
offer.

6\. Recommended business onboarding fields

Founder direction is to capture enough public-facing information so a
customer can confidently find the business and redeem the deal. The
following field set is a practical launch recommendation.

  ------------------------------------------------------------------------
  **Field**             **Priority**          **Why it matters**
  --------------------- --------------------- ----------------------------
  Public business name  Required              Used in listings, map pins,
                                              wallet, and redemption
                                              screens.

  Street address        Required              Needed for directions and
                                              location confidence.

  City, state, ZIP      Required              Supports display, geocoding,
                                              and radius logic.

  Phone number          Required              Gives the customer a direct
                                              way to confirm details.

  Hours                 Required              Helps customers avoid
                                              showing up when the shop is
                                              closed.

  Primary category      Required              Coffee shop, bakery, cafe,
                                              or similar business type.

  Logo or storefront    Recommended           Improves trust and helps the
  photo                                       customer recognize the
                                              location.

  Website and social    Recommended           Helpful but not required for
  links                                       launch.

  Pickup or redemption  Recommended           Useful for parking, inside
  note                                        pickup, counter
                                              instructions, or building
                                              access.

  Location name         Optional              Useful if a business has
                                              more than one location.
  ------------------------------------------------------------------------

7\. Page-by-page map

This section is meant to help a new developer understand the app as a
route and screen system. Screen names can be adapted to the actual
codebase, but the behavior should remain aligned with this map.

Shared entry and account flow

  ------------------------------------------------------------------------
  **Screen**       **Purpose**      **Must-have         **Priority**
                                    behavior**          
  ---------------- ---------------- ------------------- ------------------
  Auth landing     First entry      Shows penguin       Critical
                   point            branding, login,    
                                    create account,     
                                    language choice,    
                                    and clear business  
                                    vs consumer route   
                                    at login.           

  Login            Authentication   User selects        Critical
                                    business or         
                                    consumer mode here, 
                                    then signs in.      

  Create account   New account      Supports correct    Critical
                   creation         role path and leads 
                                    to the right        
                                    onboarding.         

  Forgot password  Recovery         Must work in native High
                                    build and be        
                                    reliable.           

  Language         Localization     English default.    High
  selector                          Spanish and Korean  
                                    available.          
  ------------------------------------------------------------------------

Consumer screens

  ------------------------------------------------------------------------
  **Screen**       **Purpose**      **Must-have         **Priority**
                                    behavior**          
  ---------------- ---------------- ------------------- ------------------
  Consumer         Setup discovery  Choose GPS or ZIP,  Critical
  onboarding                        pick radius, set    
                                    notifications, and  
                                    save preferences.   

  Home / live      Primary          Shows nearby and    Critical
  deals            discovery feed   favorite deals.     
                                    Live offers should  
                                    be visually         
                                    obvious.            

  Map              Location         Shows all           Critical
                   discovery        businesses with     
                                    Twofer accounts and 
                                    makes live deals    
                                    stand out strongly. 

  Deal detail      Conversion       Shows deal,         Critical
                   screen           business info, time 
                                    left, quantity      
                                    cues, and claim     
                                    CTA.                

  Business profile Trust and        Shows address,      High
                   navigation       hours, phone, and   
                                    directions entry    
                                    point.              

  Favorites        Retention        Lets users follow   High
                                    favorite businesses 
                                    and prioritize      
                                    alerts.             

  Wallet           Claim management Shows active claim, Critical
                                    countdown, QR, and  
                                    redemption state.   

  Account /        User controls    Profile,            High
  settings                          notification        
                                    settings, radius,   
                                    language, sign-out, 
                                    and support.        
  ------------------------------------------------------------------------

Business screens

  ------------------------------------------------------------------------
  **Screen**       **Purpose**      **Must-have         **Priority**
                                    behavior**          
  ---------------- ---------------- ------------------- ------------------
  Business         Initial setup    Collects public     Critical
  onboarding                        profile and first   
                                    location details    
                                    needed for          
                                    discovery.          

  Location setup   Business         Supports at least   High
                   location         one launch location 
                   management       and future          
                                    multi-location      
                                    billing logic.      

  Menu import      AI-first menu    Photo upload, AI    Critical
                   capture          extraction, review, 
                                    edit, and save to   
                                    menu library.       

  Menu manager     Structured item  Lets owner edit,    High
                   library          add, archive, and   
                                    reuse saved menu    
                                    items.              

  Create deal      Fast offer       Uses menu-first     Critical
                   builder          selections,         
                                    scheduling,         
                                    recurring options,  
                                    AI copy, and        
                                    publish flow.       

  Deal review /    Final            Shows live preview, Critical
  publish          confirmation     limits, time        
                                    window, and publish 
                                    CTA.                

  Dashboard        Operational      Shows live deals,   High
                   overview         scheduled deals,    
                                    recurring           
                                    templates, quick    
                                    actions, and        
                                    status.             

  Analytics        Owner feedback   Shows impressions,  High
                   loop             opens, claims,      
                                    redemptions if      
                                    available, and      
                                    time-window         
                                    performance.        

  Redeem           In-store         Scan QR or use      Critical
                   execution        visual fallback     
                                    without slowing     
                                    staff.              

  Billing          Subscription     Shows trial status, Critical
                   control          plans, and          
                                    subscribe or manage 
                                    actions.            

  Business account Account          Profile, team       High
  / settings       management       settings later,     
                                    support, and        
                                    sign-out.           
  ------------------------------------------------------------------------

8\. Map behavior

Map behavior matters because location is part of the product, not just a
visual extra. The map should support both discovery and urgency.

  -----------------------------------------------------------------------
  **Requirement**                **Direction**
  ------------------------------ ----------------------------------------
  **Base map**                   Use a live map for MVP.

  **What to show**               Show all businesses that have a Twofer
                                 account, not only businesses with a live
                                 deal.

  **Live deal emphasis**         Businesses with a currently active deal
                                 should stand out with a special visual
                                 state such as a pulsing blue halo or
                                 animated glow if performance permits.

  **Tap behavior**               Tapping a business should open that
                                 business profile or deal detail path.

  **Filters**                    At minimum support all businesses and
                                 live deals only.

  **Offline support**            Not required for MVP unless the live map
                                 proves unreliable or too costly.
  -----------------------------------------------------------------------

9\. Billing and subscription direction

Billing is no longer a future nice-to-have. Founder direction is to
build billing before launch. The uploaded billing update should be
treated as the detailed implementation spec for the subscription layer.
The summary below is included so a new developer can understand the
expected product behavior without opening a second file.

  ----------------------------------------------------------------------------
  **Tier**     **Monthly**   **Active     **Locations**   **Notes**
                             deals**                      
  ------------ ------------- ------------ --------------- --------------------
  Free Trial   \$0           1            1               30-day trial, basic
                                                          AI generator, basic
                                                          dashboard.

  Twofer Pro   \$30          Unlimited    1               Most independent
                                                          cafes. Full
                                                          analytics.

  Twofer       \$79          Unlimited    Up to 3         Advanced AI, full
  Premium                                                 analytics,
                                                          exportable consumer
                                                          insights.
  ----------------------------------------------------------------------------

Billing flow requirements

-   Add a Billing tab to the business experience.

-   Show trial countdown and expired-state messaging clearly.

-   Stripe Checkout should open in a secure hosted flow.

-   Webhook updates should return status to the app automatically after
    payment success.

-   Businesses should be redirected to billing if the trial expires or
    they try to create deals while inactive.

-   Pricing should be read from Supabase config, not hard-coded in the
    app.

-   Use Stripe test mode during implementation.

Multi-location foundation

Even if full multi-location management is a later expansion, the billing
update already assumes that every deal is tied to a specific location
and that Premium can support up to three locations. That means
location_id should be treated as a first-class concept now rather than a
future patch.

10\. Analytics for MVP

The analytics goal for launch is not to create a huge BI system. It is
to give a small business owner enough signal to understand whether a
deal worked, when it worked, and what to run again.

  ------------------------------------------------------------------------
  **Metric**            **Definition**          **Why it matters**
  --------------------- ----------------------- --------------------------
  Impressions           How many times a deal   Measures reach.
                        was shown in lists, map 
                        states, or              
                        notifications where     
                        measurable.             

  Clicks or opens       How many users tapped   Measures interest.
                        into the deal detail.   

  Claims                How many users claimed  Measures clear conversion.
                        the coupon.             

  Redemptions           Track directly when QR  Measures store-level
                        is used. If visual      completion when
                        redemption is used,     technically possible.
                        track only when it can  
                        be marked reliably.     

  Time-window           Performance by day and  Critical because the app
  performance           hour.                   is designed around filling
                                                slow periods.

  Repeat offer          How similar recurring   Helps owners learn what to
  performance           offer types perform     rerun.
                        over time.              
  ------------------------------------------------------------------------

Scheduling and recurring deals

These are launch features, not optional extras. Businesses need to be
able to schedule a future deal and create recurring weekly patterns for
predictable slow periods.

11\. Launch priorities in order

> **1.** Stabilize auth entry, business vs consumer routing, and
> no-open-browsing behavior.
>
> **2.** Audit the business and consumer routes already in code and
> remove broken or duplicate paths.
>
> **3.** Make the map stable and ensure live deals stand out clearly.
>
> **4.** Finish the AI-first business setup path, especially menu
> capture and menu-driven deal creation.
>
> **5.** Finish scheduling and recurring deal support.
>
> **6.** Verify wallet, claim rules, QR redemption, and visual fallback
> behavior end to end.
>
> **7.** Implement billing using the uploaded billing handoff and Stripe
> test mode.
>
> **8.** Lock down analytics event tracking for impressions, opens,
> claims, and redemption events where possible.
>
> **9.** Polish the demo business account and sample data so investors,
> pilot shops, and testers can experience the app quickly.
>
> **10.** Run manual launch QA across iOS, Android, business mode, and
> consumer mode.

12\. Recommended first-week plan for the new developer

  -----------------------------------------------------------------------
  **Day**            **Focus**           **What to produce**
  ------------------ ------------------- --------------------------------
  1                  Repo and build      Local build, EAS profile check,
                     audit               Supabase env check, route
                                         inventory, known crash list.

  2                  Business flow audit Truth table of what business
                                         onboarding, create-deal, menu,
                                         and billing screens currently
                                         do.

  3                  Consumer flow audit Truth table of onboarding, home,
                                         map, wallet, claim, and
                                         redemption behavior.

  4                  Architecture        Clear plan for role routing,
                     decisions           menu schema, billing
                                         integration, event tracking, and
                                         scheduled deal model.

  5                  Execution plan      Prioritized sprint plan with
                                         bugs, missing screens, and
                                         release blockers.
  -----------------------------------------------------------------------

Appendix: billing source of truth

Use Dan\'s uploaded billing handoff as the detailed implementation
source for Stripe plans, screens, Supabase schema changes, webhook
events, and testing rules. This merged handoff captures the high-level
product direction and founder decisions. The billing update provides the
exact subscription implementation details.

Final note to developer

  -----------------------------------------------------------------------
  **The biggest thing to preserve is the product feel.** Twofer should
  feel local, simple, fast, and AI-assisted on the business side. If a
  build choice adds form friction, extra typing, or operational delay, it
  is probably the wrong choice.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
