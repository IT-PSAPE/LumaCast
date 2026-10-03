#include "../../../packages/ndi-native/src/gpu-texture.h"
#import <Foundation/Foundation.h>
#import <IOSurface/IOSurface.h>
#include <servers/bootstrap.h>
#include <cassert>
#include <cmath>
#include <cstring>
#include <stdexcept>
#include <string>
#include <sys/wait.h>
#include <unistd.h>

struct TestPortMessage {
  mach_msg_header_t header{};
  mach_msg_body_t body{};
  mach_msg_port_descriptor_t descriptor{};
  char token[32]{};
};

int main(int argc, char** argv) {
  if (argc == 4 && std::strcmp(argv[1], "--receiver") == 0) {
    @autoreleasepool {
      try {
        const int endpointFd = std::stoi(argv[2]);
        const int tokenFd = std::stoi(argv[3]);
        const auto endpoint = ndi_gpu::ReceiverEndpoint();
        char name[128]{};
        assert(endpoint.size() < sizeof(name));
        std::memcpy(name, endpoint.data(), endpoint.size());
        assert(write(endpointFd, name, sizeof(name)) == sizeof(name));
        char token[32];
        assert(read(tokenFd, token, sizeof(token)) == sizeof(token));
        ndi_gpu::Handle descriptor;
        descriptor.token.assign(token, sizeof(token));
        bool rejected = false;
        try { ndi_gpu::Lookup(descriptor, 2, 2, "bgra"); }
        catch (const std::runtime_error&) { rejected = true; }
        assert(rejected);
        assert(read(tokenFd, token, sizeof(token)) == sizeof(token));
        descriptor.token.assign(token, sizeof(token));
        return ndi_gpu::Lookup(descriptor, 2, 2, "bgra") ? 0 : 1;
      } catch (const std::exception& error) {
        std::fprintf(stderr, "child IOSurface import: %s\n", error.what());
        return 1;
      }
    }
  }
  @autoreleasepool {
    const bool hasMetal = ndi_gpu::Supported();
    NSDictionary* properties = @{
      (id)kIOSurfaceWidth: @2, (id)kIOSurfaceHeight: @2,
      (id)kIOSurfaceBytesPerElement: @4, (id)kIOSurfaceBytesPerRow: @16,
      (id)kIOSurfaceAllocSize: @32, (id)kIOSurfacePixelFormat: @(0x42475241U),
    };
    IOSurfaceRef surface = IOSurfaceCreate((CFDictionaryRef)properties);
    assert(surface);
    assert(IOSurfaceLock(surface, 0, nullptr) == kIOReturnSuccess);
    auto* pixels = static_cast<uint8_t*>(IOSurfaceGetBaseAddress(surface));
    const uint8_t source[] = {0, 0, 255, 255, 0, 0, 255, 255,
                             0, 0, 128, 128, 0, 0, 128, 128};
    std::memcpy(pixels, source, 8);
    std::memcpy(pixels + 16, source + 8, 8);
    IOSurfaceUnlock(surface, 0, nullptr);
    uint8_t handle[sizeof(surface)];
    std::memcpy(handle, &surface, sizeof(surface));
    const uint32_t id = ndi_gpu::SurfaceId(handle, sizeof(handle));
    const mach_port_t localPort = IOSurfaceCreateMachPort(surface);
    assert(localPort != MACH_PORT_NULL);
    IOSurfaceRef localImported = IOSurfaceLookupFromMachPort(localPort);
    assert(localImported);
    CFRelease(localImported);
    mach_port_deallocate(mach_task_self(), localPort);
    int endpointPipe[2], tokenPipe[2];
    assert(pipe(endpointPipe) == 0 && pipe(tokenPipe) == 0);
    // Transfer a Mach send right to a separate process. The child imports
    // through the descriptor token, never the inherited IOSurfaceRef pointer.
    const pid_t child = fork();
    assert(child >= 0);
    if (child == 0) {
      close(endpointPipe[0]); close(tokenPipe[1]);
      const auto endpointFd = std::to_string(endpointPipe[1]);
      const auto tokenFd = std::to_string(tokenPipe[0]);
      execl(argv[0], argv[0], "--receiver", endpointFd.c_str(), tokenFd.c_str(), nullptr);
      _exit(1);
    }
    close(endpointPipe[1]); close(tokenPipe[0]);
    char endpoint[128]{};
    assert(read(endpointPipe[0], endpoint, sizeof(endpoint)) == sizeof(endpoint));
    mach_port_t receiver = MACH_PORT_NULL, malformedPort = MACH_PORT_NULL, replyPort = MACH_PORT_NULL;
    assert(bootstrap_look_up(bootstrap_port, endpoint, &receiver) == KERN_SUCCESS);
    assert(mach_port_allocate(mach_task_self(), MACH_PORT_RIGHT_RECEIVE, &malformedPort) == KERN_SUCCESS);
    assert(mach_port_insert_right(mach_task_self(), malformedPort, malformedPort, MACH_MSG_TYPE_MAKE_SEND) == KERN_SUCCESS);
    assert(mach_port_allocate(mach_task_self(), MACH_PORT_RIGHT_RECEIVE, &replyPort) == KERN_SUCCESS);
    TestPortMessage malformed{};
    malformed.header.msgh_bits = MACH_MSGH_BITS(MACH_MSG_TYPE_COPY_SEND, MACH_MSG_TYPE_MAKE_SEND)
        | MACH_MSGH_BITS_COMPLEX;
    malformed.header.msgh_size = sizeof(malformed);
    malformed.header.msgh_remote_port = receiver;
    malformed.header.msgh_local_port = replyPort;
    malformed.body.msgh_descriptor_count = 1;
    malformed.descriptor.name = malformedPort;
    malformed.descriptor.disposition = MACH_MSG_TYPE_MOVE_RECEIVE;
    malformed.descriptor.type = MACH_MSG_PORT_DESCRIPTOR;
    std::memset(malformed.token, 'f', sizeof(malformed.token));
    assert(mach_msg(&malformed.header, MACH_SEND_MSG, sizeof(malformed), 0,
                    MACH_PORT_NULL, MACH_MSG_TIMEOUT_NONE, MACH_PORT_NULL) == MACH_MSG_SUCCESS);
    mach_port_deallocate(mach_task_self(), receiver);
    assert(write(tokenPipe[1], malformed.token, sizeof(malformed.token)) == sizeof(malformed.token));
    const auto transferred = ndi_gpu::Export(handle, sizeof(handle), child, endpoint, {}, 0);
    assert(transferred.token.size() == 32);
    assert(write(tokenPipe[1], transferred.token.data(), transferred.token.size()) == 32);
    close(endpointPipe[0]); close(tokenPipe[1]);
    int status = 0;
    assert(waitpid(child, &status, 0) == child);
    assert(WIFEXITED(status) && WEXITSTATUS(status) == 0);
    mach_port_type_t malformedType = 0;
    assert(mach_port_type(mach_task_self(), malformedPort, &malformedType) == KERN_SUCCESS);
    assert(malformedType & MACH_PORT_TYPE_DEAD_NAME);
    mach_port_deallocate(mach_task_self(), malformedPort);
    mach_port_mod_refs(mach_task_self(), replyPort, MACH_PORT_RIGHT_RECEIVE, -1);
    auto imported = ndi_gpu::Lookup(id, 2, 2, "bgra");
    if (hasMetal) {
      auto converter = ndi_gpu::CreateConverter(2, 2, true);
      const auto output = converter->Convert(*imported, 0);
      assert(output.size == 12 && output.stride == 4 && output.fourCC == 0x41565955U);
      assert(std::abs(int(output.data[0]) - 102) <= 1);
      assert(std::abs(int(output.data[1]) - 63) <= 1);
      assert(std::abs(int(output.data[2]) - 240) <= 1);
      for (int i = 0; i < 4; ++i) assert(output.data[i] == output.data[i + 4]);
      assert(output.data[8] == 255 && output.data[9] == 255);
      assert(output.data[10] == 128 && output.data[11] == 128);
      const auto second = converter->Convert(*imported, 1);
      assert(second.data != output.data);
      assert(converter->Convert(*imported, 0).data == output.data);
      auto opaque = ndi_gpu::CreateConverter(2, 2, false);
      const auto opaqueOutput = opaque->Convert(*imported, 0);
      assert(opaqueOutput.size == 8 && opaqueOutput.fourCC == 0x59565955U);
      assert(opaqueOutput.data[5] < opaqueOutput.data[1]);
    } else {
      std::puts("Mach/IOSurface transfer passed; Metal conversion skipped: no Metal device on this host");
    }
    bool rejected = false;
    try { ndi_gpu::Lookup(id, 4, 2, "bgra"); } catch (const std::runtime_error&) { rejected = true; }
    assert(rejected);
    rejected = false;
    try { ndi_gpu::Lookup(id, 2, 2, "rgba"); } catch (const std::runtime_error&) { rejected = true; }
    assert(rejected);
    rejected = false;
    try { ndi_gpu::SurfaceId(handle, sizeof(handle) - 1); } catch (const std::runtime_error&) { rejected = true; }
    assert(rejected);
    imported.reset();
    CFRelease(surface);
  }
}
