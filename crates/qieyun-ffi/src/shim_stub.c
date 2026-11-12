// 没有 librime 时的替身：保证 crate 在任意机器上都能编译（CI / 纯前端开发者）。
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct { int unused; } qz_engine;

const char* qz_version(void) { return "(librime not linked)"; }
int qz_available(void) { return 0; }

int qz_deploy(const char* user_dir, const char* shared_dir) {
  (void)user_dir;
  (void)shared_dir;
  return 0;
}

qz_engine* qz_create(const char* user_dir, const char* shared_dir) {
  (void)user_dir;
  (void)shared_dir;
  return NULL;
}
void qz_destroy(qz_engine* e) { free(e); }
uintptr_t qz_session_new(qz_engine* e) { (void)e; return 0; }
void qz_session_destroy(qz_engine* e, uintptr_t s) { (void)e; (void)s; }
int qz_process_key(qz_engine* e, uintptr_t s, int k) { (void)e; (void)s; (void)k; return 0; }
int qz_context(qz_engine* e, uintptr_t s, char* p, int pc, char* c, int cc) {
  (void)e; (void)s; (void)pc; (void)cc;
  if (p) p[0] = '\0';
  if (c) c[0] = '\0';
  return -1;
}
int qz_select(qz_engine* e, uintptr_t s, int i, char* c, int cc) {
  (void)e; (void)s; (void)i; (void)cc;
  if (c) c[0] = '\0';
  return -1;
}
