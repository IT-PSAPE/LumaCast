{
  "variables": {
    "zoom_sdk_root%": "<!(node -p \"process.env.ZOOM_MEETING_SDK_ROOT || ''\")"
  },
  "targets": [
    {
      "target_name": "lumastream-zoom-sdk",
      "sources": ["zoom-sdk-addon.cc"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        ".",
        "<(zoom_sdk_root)/h"
      ],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "defines": ["NAPI_CPP_EXCEPTIONS"],
      "cflags_cc": ["-std=c++17"],
      "cflags_cc!": ["-fno-exceptions"],
      "win_delay_load_hook": "true",
      "conditions": [
        ["OS=='win'", {
          "sources": ["windows/zoom-sdk-bridge.cpp"],
          "include_dirs": [".", "<(zoom_sdk_root)/h"],
          "library_dirs": ["<(zoom_sdk_root)/lib"],
          "libraries": ["sdk.lib"],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "AdditionalOptions": ["/std:c++17"],
              "ExceptionHandling": 1
            }
          }
        }],
        ["OS=='mac'", {
          "sources": ["macos/zoom-sdk-bridge.mm"],
          "include_dirs": [".", "<(zoom_sdk_root)"],
          "link_settings": {
            "libraries": [
              "-F<(zoom_sdk_root)",
              "-framework ZoomSDK",
              "-framework protobuf"
            ]
          },
          "xcode_settings": {
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "CLANG_CXX_LIBRARY": "libc++",
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "MACOSX_DEPLOYMENT_TARGET": "10.15",
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "LD_RUNPATH_SEARCH_PATHS": ["@loader_path", "@loader_path/Frameworks"]
          }
        }],
        ["OS!='win' and OS!='mac'", {
          "type": "none"
        }]
      ]
    }
  ]
}
