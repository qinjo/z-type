// 切韵 · librime C shim
//
// 目标：对 Rust 暴露一个窄而稳定的 ABI，避免在 Rust 侧手抄 RimeApi 的几十个函数指针。
// 升级 librime 只需要重新编译本文件，不用改 Rust 绑定。

#include <rime_api.h>

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
  RimeApi* api;
  char* user_dir;
  char* shared_dir;
} qz_engine;

static void qz_traits(RimeTraits* t, const char* user, const char* shared) {
  memset(t, 0, sizeof(*t));
  RIME_STRUCT_INIT(RimeTraits, *t);
  t->shared_data_dir = shared;
  t->user_data_dir = user;
  t->distribution_name = "Qieyun";
  t->distribution_code_name = "qieyun";
  t->distribution_version = "0.1";
  t->app_name = "rime.qieyun";
}

const char* qz_version(void) {
  RimeApi* api = rime_get_api();
  return api && api->get_version ? api->get_version() : "(unknown)";
}

int qz_available(void) { return rime_get_api() != NULL; }

// 独立部署（不需要先建 engine）。返回 1 成功、0 失败。
int qz_deploy(const char* user_dir, const char* shared_dir) {
  RimeApi* api = rime_get_api();
  if (!api || !api->deployer_initialize || !api->deploy) {
    return 0;
  }
  RimeTraits t;
  qz_traits(&t, user_dir, shared_dir);
  api->setup(&t);
  api->deployer_initialize(&t);
  Bool ok = api->deploy();
  api->finalize();
  return ok ? 1 : 0;
}

qz_engine* qz_create(const char* user_dir, const char* shared_dir) {
  RimeApi* api = rime_get_api();
  if (!api || !api->initialize) {
    return NULL;
  }
  qz_engine* e = (qz_engine*)calloc(1, sizeof(qz_engine));
  if (!e) {
    return NULL;
  }
  e->api = api;
  e->user_dir = strdup(user_dir);
  e->shared_dir = strdup(shared_dir);

  RimeTraits t;
  qz_traits(&t, e->user_dir, e->shared_dir);
  api->setup(&t);
  api->initialize(&t);
  return e;
}

void qz_destroy(qz_engine* e) {
  if (!e) {
    return;
  }
  if (e->api && e->api->finalize) {
    e->api->finalize();
  }
  free(e->user_dir);
  free(e->shared_dir);
  free(e);
}

uintptr_t qz_session_new(qz_engine* e) {
  if (!e || !e->api->create_session) {
    return 0;
  }
  return (uintptr_t)e->api->create_session();
}

void qz_session_destroy(qz_engine* e, uintptr_t session) {
  if (e && e->api->destroy_session) {
    e->api->destroy_session((RimeSessionId)session);
  }
}

int qz_process_key(qz_engine* e, uintptr_t session, int keycode) {
  if (!e || !e->api->process_key) {
    return 0;
  }
  return e->api->process_key((RimeSessionId)session, keycode, 0) ? 1 : 0;
}

// 读取上下文：preedit 与候选（每行 `text\tcomment`）。返回候选数；失败返回 -1。
int qz_context(qz_engine* e, uintptr_t session, char* preedit, int preedit_cap,
               char* candidates, int candidates_cap) {
  if (!e || !e->api->get_context) {
    return -1;
  }
  RIME_STRUCT(RimeContext, ctx);
  if (!e->api->get_context((RimeSessionId)session, &ctx)) {
    if (preedit_cap > 0) preedit[0] = '\0';
    if (candidates_cap > 0) candidates[0] = '\0';
    return -1;
  }

  if (preedit_cap > 0) {
    const char* p = ctx.composition.preedit ? ctx.composition.preedit : "";
    strncpy(preedit, p, (size_t)preedit_cap - 1);
    preedit[preedit_cap - 1] = '\0';
  }

  int count = ctx.menu.num_candidates;
  if (candidates_cap > 0) {
    size_t off = 0;
    candidates[0] = '\0';
    for (int i = 0; i < count; i++) {
      const char* text = ctx.menu.candidates[i].text ? ctx.menu.candidates[i].text : "";
      const char* comment = ctx.menu.candidates[i].comment ? ctx.menu.candidates[i].comment : "";
      int written = snprintf(candidates + off, (size_t)(candidates_cap - (int)off), "%s\t%s\n",
                             text, comment);
      if (written < 0 || written >= candidates_cap - (int)off) {
        break;
      }
      off += (size_t)written;
    }
  }

  if (e->api->free_context) {
    e->api->free_context(&ctx);
  } else if (ctx.menu.candidates) {
    free(ctx.menu.candidates);
  }
  return count;
}

// 切换会话选项（ascii_mode / full_shape / transcription 等）。返回 1 成功。
int qz_set_option(qz_engine* e, uintptr_t session, const char* option, int value) {
  if (!e || !e->api->set_option || !option) {
    return 0;
  }
  e->api->set_option((RimeSessionId)session, option, value ? True : False);
  return 1;
}

int qz_get_option(qz_engine* e, uintptr_t session, const char* option) {
  if (!e || !e->api->get_option || !option) {
    return -1;
  }
  return e->api->get_option((RimeSessionId)session, option) ? 1 : 0;
}

// 当前会话使用的方案 id。返回 1 成功。
int qz_current_schema(qz_engine* e, uintptr_t session, char* out, int cap) {
  if (!e || !e->api->get_current_schema || cap <= 0) {
    return 0;
  }
  if (!e->api->get_current_schema((RimeSessionId)session, out, (size_t)cap)) {
    if (cap > 0) out[0] = '\0';
    return 0;
  }
  return 1;
}

// 选中第 idx 个候选，若产生上屏文本则写入 commit。返回 1 有上屏、0 无、-1 失败。
int qz_select(qz_engine* e, uintptr_t session, int idx, char* commit, int commit_cap) {
  if (!e || !e->api->select_candidate) {
    return -1;
  }
  if (!e->api->select_candidate((RimeSessionId)session, (size_t)idx)) {
    return -1;
  }
  if (!e->api->get_commit) {
    return -1;
  }
  RIME_STRUCT(RimeCommit, c);
  int ok = e->api->get_commit((RimeSessionId)session, &c) ? 1 : 0;
  if (ok && c.text && commit_cap > 0) {
    strncpy(commit, c.text, (size_t)commit_cap - 1);
    commit[commit_cap - 1] = '\0';
  } else if (commit_cap > 0) {
    commit[0] = '\0';
  }
  int has_text = (ok && c.text && c.text[0]) ? 1 : 0;
  if (e->api->free_commit) {
    e->api->free_commit(&c);
  }
  return has_text;
}
