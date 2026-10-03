{
  "targets": [
    {
      "target_name": "ndi_native",
      "sources": ["src/ndi_native.cc"],
      "conditions": [
        ["OS=='mac'", {
          "sources": ["src/gpu-texture-mac.mm"],
          "link_settings": { "libraries": ["-framework Metal", "-framework IOSurface", "-framework Foundation"] }
        }],
        ["OS=='win'", {
          "sources": ["src/gpu-texture-win.cc"],
          "libraries": ["d3d11.lib", "dxgi.lib"]
        }],
        ["OS=='linux'", {
          "sources": ["src/gpu-texture-linux.cc"],
          "libraries": ["-lEGL", "-lGLESv2", "-lpthread"]
        }]
      ],
      "include_dirs": ["<!@(node -p \"require('node-addon-api').include\")"],
      "dependencies": ["<!(node -p \"require('node-addon-api').gyp\")"],
      "defines": ["NAPI_CPP_EXCEPTIONS"],
      "win_delay_load_hook": "true",
      "cflags_cc": ["-std=c++17"],
      "cflags_cc!": ["-fno-exceptions"],
      "xcode_settings": {
        "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
        "CLANG_CXX_LIBRARY": "libc++",
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        "MACOSX_DEPLOYMENT_TARGET": "11.0"
      },
      "msvs_settings": {
        "VCCLCompilerTool": {
          "AdditionalOptions": ["/std:c++17"],
          "ExceptionHandling": 1
        }
      }
    }
  ]
}
