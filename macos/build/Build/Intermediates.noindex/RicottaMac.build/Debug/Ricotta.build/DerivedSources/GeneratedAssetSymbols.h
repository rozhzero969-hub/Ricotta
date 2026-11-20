#import <Foundation/Foundation.h>

#if __has_attribute(swift_private)
#define AC_SWIFT_PRIVATE __attribute__((swift_private))
#else
#define AC_SWIFT_PRIVATE
#endif

/// The resource bundle ID.
static NSString * const ACBundleID AC_SWIFT_PRIVATE = @"com.rozh.ricotta.mac";

/// The "AccentColor" asset catalog color resource.
static NSString * const ACColorNameAccentColor AC_SWIFT_PRIVATE = @"AccentColor";

/// The "AppIcon-dark" asset catalog image resource.
static NSString * const ACImageNameAppIconDark AC_SWIFT_PRIVATE = @"AppIcon-dark";

/// The "AppIcon-green" asset catalog image resource.
static NSString * const ACImageNameAppIconGreen AC_SWIFT_PRIVATE = @"AppIcon-green";

/// The "AppIcon-light" asset catalog image resource.
static NSString * const ACImageNameAppIconLight AC_SWIFT_PRIVATE = @"AppIcon-light";

/// The "AppIcon-mint" asset catalog image resource.
static NSString * const ACImageNameAppIconMint AC_SWIFT_PRIVATE = @"AppIcon-mint";

/// The "AppIcon-sky" asset catalog image resource.
static NSString * const ACImageNameAppIconSky AC_SWIFT_PRIVATE = @"AppIcon-sky";

/// The "AppIcon-wordmark" asset catalog image resource.
static NSString * const ACImageNameAppIconWordmark AC_SWIFT_PRIVATE = @"AppIcon-wordmark";

/// The "LoadingLogo" asset catalog image resource.
static NSString * const ACImageNameLoadingLogo AC_SWIFT_PRIVATE = @"LoadingLogo";

#undef AC_SWIFT_PRIVATE
