# Rouen Lite's JNI library (dev/design/rouen-lite.md §3): starts Node 24 (libnode.so) on Rouen's server. It neither
# links libnode nor includes its headers: node::Start is found in the loaded libnode.so at run time, so this builds
# without the CI-made libnode in place, and nothing of Node's V8 build settings has to match here.
cmake_minimum_required(VERSION 3.22.1)
project(rouenlite CXX)
set(CMAKE_CXX_STANDARD 17)
add_library(rouenlite SHARED rouenlite.cpp)
find_library(log-lib log)
target_link_libraries(rouenlite ${log-lib} dl)
