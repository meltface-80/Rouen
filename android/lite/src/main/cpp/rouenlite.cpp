// rouenlite.cpp — Node started on Rouen's server (dev/design/rouen-lite.md §3), from NodeRunner.kt.
//
// Node's own entry, node::Start(int, char**), is looked up in libnode.so (loaded first, by System.loadLibrary) by its
// C++ name, so this library needs neither Node's headers nor a link against it. Node takes argv as one block of memory,
// as a process is given it, so the arguments are copied into one. Node's stdout and stderr are Rouen's log: they are
// sent on to Android's log, under the tag RouenLite, line by line.
#include <jni.h>
#include <android/log.h>
#include <dlfcn.h>
#include <pthread.h>
#include <unistd.h>
#include <cstdlib>
#include <cstring>
#include <vector>

namespace {

const char* TAG = "RouenLite";

// node::Start(int argc, char** argv), as libnode.so exports it.
typedef int (*NodeStart)(int, char**);
const char* NODE_START = "_ZN4node5StartEiPPc";

int pipeFd[2];

void* forward(void*) {
    char buf[2048];
    std::vector<char> line;
    ssize_t n;
    while ((n = read(pipeFd[0], buf, sizeof buf)) > 0) {
        for (ssize_t i = 0; i < n; i++) {
            if (buf[i] == '\n') {
                line.push_back('\0');
                __android_log_write(ANDROID_LOG_INFO, TAG, line.data());
                line.clear();
            } else {
                line.push_back(buf[i]);
            }
        }
    }
    return nullptr;
}

// stdout and stderr to Android's log, once.
void forwardOutput() {
    static bool done = false;
    if (done) return;
    done = true;
    setvbuf(stdout, nullptr, _IOLBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    if (pipe(pipeFd) != 0) return;
    dup2(pipeFd[1], STDOUT_FILENO);
    dup2(pipeFd[1], STDERR_FILENO);
    pthread_t t;
    if (pthread_create(&t, nullptr, forward, nullptr) == 0) pthread_detach(t);
}

}  // namespace

extern "C" JNIEXPORT jint JNICALL
Java_app_rouen_lite_NodeRunner_startNode(JNIEnv* env, jclass, jobjectArray arguments) {
    void* lib = dlopen("libnode.so", RTLD_NOW | RTLD_NOLOAD);
    if (!lib) lib = dlopen("libnode.so", RTLD_NOW);
    if (!lib) {
        __android_log_print(ANDROID_LOG_ERROR, TAG, "libnode.so isn't in this APK: %s", dlerror());
        return -1;
    }
    auto start = reinterpret_cast<NodeStart>(dlsym(lib, NODE_START));
    if (!start) {
        __android_log_print(ANDROID_LOG_ERROR, TAG, "libnode.so has no node::Start: %s", dlerror());
        return -2;
    }

    // The arguments, end to end in one block, as a process's argv is.
    const jsize argc = env->GetArrayLength(arguments);
    size_t total = 0;
    std::vector<std::vector<char>> args(argc);
    for (jsize i = 0; i < argc; i++) {
        auto s = static_cast<jstring>(env->GetObjectArrayElement(arguments, i));
        const char* c = env->GetStringUTFChars(s, nullptr);
        args[i].assign(c, c + strlen(c) + 1);
        total += args[i].size();
        env->ReleaseStringUTFChars(s, c);
        env->DeleteLocalRef(s);
    }
    // Node keeps argv for the life of the process: never freed.
    char* block = static_cast<char*>(calloc(total, 1));
    std::vector<char*> argv(argc + 1, nullptr);
    char* at = block;
    for (jsize i = 0; i < argc; i++) {
        memcpy(at, args[i].data(), args[i].size());
        argv[i] = at;
        at += args[i].size();
    }

    forwardOutput();
    return start(argc, argv.data());
}
