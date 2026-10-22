"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatModule = void 0;
const common_1 = require("@nestjs/common");
const agents_module_1 = require("../agents/agents.module");
const knowledge_module_1 = require("../knowledge/knowledge.module");
const llm_module_1 = require("../llm/llm.module");
const session_service_1 = require("../sessions/session.service");
const history_service_1 = require("../history/history.service");
const chat_gateway_1 = require("./chat.gateway");
let ChatModule = class ChatModule {
};
exports.ChatModule = ChatModule;
exports.ChatModule = ChatModule = __decorate([
    (0, common_1.Module)({
        imports: [llm_module_1.LlmModule, knowledge_module_1.KnowledgeModule, agents_module_1.AgentsModule],
        providers: [chat_gateway_1.ChatGateway, session_service_1.SessionService, history_service_1.HistoryService],
    })
], ChatModule);
//# sourceMappingURL=chat.module.js.map