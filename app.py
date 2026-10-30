
import os
import ast
import json
import secrets
import string
import operator
import logging

from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv

try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None
    types = None


# ==================================================
# CONFIGURATION
# ==================================================

load_dotenv(override=True)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 1 * 1024 * 1024

logging.basicConfig(level=logging.INFO)

API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv(
    "GEMINI_MODEL",
    "gemini-3.6-flash"
).strip()

FALLBACK_MODELS = [
    GEMINI_MODEL,
    "gemini-3.5-flash-lite",
    "gemini-3.6-flash",
    "gemini-3.8-flash",
]

SYSTEM_ASSISTANT = """
You are CodeBox Pro AI Assistant.

Help users with programming, debugging, learning, and technology.
You can assist with Python, Java, C++, JavaScript, HTML, CSS, SQL,
and other programming topics.

Be friendly, accurate, and practical.
Explain solutions clearly.
When asked for code, provide complete usable code when appropriate.
Reply in the language used by the user, including Arabic.
"""

SYSTEM_CODE_GENERATOR = """
You are CodeBox Pro Code Generator.

Generate correct, readable, and useful code based on the user's request.
Use the programming language requested by the user.
Include helpful comments when appropriate.
If the user asks to fix code, explain the important changes briefly.
Reply in the user's language.
"""


# ==================================================
# GEMINI CLIENT
# ==================================================

def gemini_client():
    if not API_KEY:
        raise RuntimeError(
            "مفتاح Gemini غير موجود. "
            "تأكد من وجود GEMINI_API_KEY في ملف .env."
        )

    if genai is None or types is None:
        raise RuntimeError(
            "مكتبة google-genai غير مثبتة. "
            "نفّذ: pip install google-genai"
        )

    return genai.Client(api_key=API_KEY)


def get_status_code(error):
    """Extract the HTTP status code from a Gemini error."""
    code = getattr(error, "code", None)

    if code is None:
        code = getattr(error, "status_code", None)

    try:
        return int(code)
    except (TypeError, ValueError):
        return None


def ask_gemini(prompt, system_instruction):
    """
    Try the configured Gemini model, then fallback models
    when a model is temporarily unavailable or rate-limited.
    """
    client = gemini_client()

    models = list(dict.fromkeys(FALLBACK_MODELS))
    last_error = None

    for model in models:
        try:
            app.logger.info("Trying Gemini model: %s", model)

            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    temperature=0.4,
                ),
            )

            answer = getattr(response, "text", None)

            if answer and answer.strip():
                app.logger.info(
                    "Gemini response received from %s",
                    model
                )
                return answer.strip()

            raise RuntimeError(
                f"Gemini model {model} returned an empty response."
            )

        except Exception as error:
            last_error = error
            status_code = get_status_code(error)

            message = str(error)

            is_temporary_error = (
                status_code in (429, 500, 502, 503, 504)
                or any(
                    code in message
                    for code in (
                        "429",
                        "500 INTERNAL",
                        "502",
                        "503",
                        "504",
                    )
                )
            )

            app.logger.warning(
                "Gemini model %s failed. HTTP status: %s",
                model,
                status_code
            )

            # Only try another model for temporary server,
            # availability, or rate-limit errors.
            if not is_temporary_error:
                raise

    raise RuntimeError(
        "تعذر الحصول على رد من جميع موديلات Gemini المتاحة. "
        "حاول مرة أخرى بعد قليل."
    ) from last_error


# ==================================================
# HOME PAGE
# ==================================================

@app.route("/")
def home():
    return render_template("index.html")


# ==================================================
# HEALTH CHECK
# ==================================================

@app.route("/health")
def health():
    return jsonify({
        "status": "ok",
        "app": "CodeBox Pro",
        "gemini_configured": bool(API_KEY),
        "configured_model": GEMINI_MODEL,
    }), 200


# ==================================================
# CHAT API
# ==================================================

@app.route("/api/chat", methods=["POST"])
def api_chat():
    data = request.get_json(silent=True) or {}

    prompt = (
        data.get("message")
        or data.get("prompt")
        or data.get("text")
        or ""
    ).strip()

    if not prompt:
        return jsonify({
            "error": "اكتب رسالتك أولًا."
        }), 400

    if len(prompt) > 20000:
        return jsonify({
            "error": "الرسالة طويلة جدًا. اختصرها وحاول مرة أخرى."
        }), 400

    try:
        answer = ask_gemini(
            prompt,
            SYSTEM_ASSISTANT
        )

        return jsonify({
            "answer": answer,
            "response": answer,
            "reply": answer,
            "success": True,
        }), 200

    except Exception as error:
        app.logger.exception("Gemini chat error")

        message = str(error)

        if "503" in message or "UNAVAILABLE" in message:
            user_message = (
                "خدمة Gemini مشغولة حاليًا. "
                "انتظر قليلًا وحاول مرة أخرى."
            )
        elif "429" in message or "RESOURCE_EXHAUSTED" in message:
            user_message = (
                "تم الوصول إلى حد الاستخدام المتاح لـ Gemini. "
                "تحقق من الحصة المتاحة أو حاول لاحقًا."
            )
        elif "API_KEY_INVALID" in message or "API key not valid" in message:
            user_message = (
                "مفتاح Gemini غير صالح. راجع قيمة GEMINI_API_KEY في ملف .env."
            )
        else:
            user_message = (
                "تعذر الحصول على رد من Gemini. "
                "راجع Terminal لمعرفة تفاصيل الخطأ."
            )

        return jsonify({
            "error": user_message,
            "success": False,
        }), 503


# ==================================================
# AI CODE GENERATOR
# ==================================================

@app.route("/api/generate", methods=["POST"])
def api_generate():
    data = request.get_json(silent=True) or {}

    prompt = (
        data.get("prompt")
        or data.get("message")
        or data.get("description")
        or ""
    ).strip()

    language = (
        data.get("language")
        or data.get("programming_language")
        or "Python"
    ).strip()

    if not prompt:
        return jsonify({
            "error": "اكتب وصف الكود الذي تريد إنشاءه."
        }), 400

    if len(prompt) > 20000:
        return jsonify({
            "error": "الوصف طويل جدًا. اختصره وحاول مرة أخرى."
        }), 400

    full_prompt = (
        f"Programming language: {language}\n\n"
        f"User request:\n{prompt}"
    )

    try:
        code = ask_gemini(
            full_prompt,
            SYSTEM_CODE_GENERATOR
        )

        return jsonify({
            "code": code,
            "answer": code,
            "success": True,
        }), 200

    except Exception:
        app.logger.exception("Gemini code generation error")

        return jsonify({
            "error": (
                "تعذر إنشاء الكود حاليًا. "
                "حاول مرة أخرى أو راجع Terminal."
            ),
            "success": False,
        }), 503


# ==================================================
# SAFE CALCULATOR
# ==================================================

BINARY_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}

UNARY_OPERATORS = {
    ast.UAdd: operator.pos,
    ast.USub: operator.neg,
}


def safe_calculate(expression):
    """Evaluate basic arithmetic without using eval()."""
    tree = ast.parse(expression, mode="eval")

    def evaluate(node):
        if isinstance(node, ast.Expression):
            return evaluate(node.body)

        if isinstance(node, ast.Constant):
            if (
                isinstance(node.value, bool)
                or not isinstance(node.value, (int, float))
            ):
                raise ValueError("استخدم الأرقام والعمليات الحسابية فقط.")

            return node.value

        if isinstance(node, ast.BinOp):
            operation = BINARY_OPERATORS.get(type(node.op))

            if operation is None:
                raise ValueError("العملية الحسابية غير مدعومة.")

            left = evaluate(node.left)
            right = evaluate(node.right)

            if isinstance(node.op, ast.Pow) and abs(right) > 1000:
                raise ValueError("الأس كبير جدًا.")

            result = operation(left, right)

            if isinstance(result, (int, float)):
                if abs(result) > 1e100:
                    raise ValueError("الناتج كبير جدًا.")

            return result

        if isinstance(node, ast.UnaryOp):
            operation = UNARY_OPERATORS.get(type(node.op))

            if operation is None:
                raise ValueError("العملية غير مدعومة.")

            return operation(evaluate(node.operand))

        raise ValueError("التعبير يحتوي على عمليات غير مسموحة.")

    return evaluate(tree)


@app.route("/api/calculate", methods=["POST"])
def api_calculate():
    data = request.get_json(silent=True) or {}

    expression = str(
        data.get("expression")
        or data.get("calculation")
        or data.get("value")
        or ""
    ).strip()

    if not expression:
        return jsonify({
            "error": "اكتب العملية الحسابية أولًا."
        }), 400

    if len(expression) > 200:
        return jsonify({
            "error": "العملية الحسابية طويلة جدًا."
        }), 400

    try:
        result = safe_calculate(expression)

        return jsonify({
            "result": result,
            "success": True,
        }), 200

    except ZeroDivisionError:
        return jsonify({
            "error": "لا يمكن القسمة على صفر."
        }), 400

    except (ValueError, SyntaxError, OverflowError) as error:
        return jsonify({
            "error": str(error) or "عملية حسابية غير صحيحة."
        }), 400


# ==================================================
# PASSWORD GENERATOR
# ==================================================

@app.route("/api/password", methods=["POST"])
def api_password():
    data = request.get_json(silent=True) or {}

    try:
        length = int(data.get("length", 16))
    except (TypeError, ValueError):
        return jsonify({
            "error": "طول كلمة المرور يجب أن يكون رقمًا."
        }), 400

    if not 8 <= length <= 128:
        return jsonify({
            "error": "اختر طولًا من 8 إلى 128 حرفًا."
        }), 400

    characters = string.ascii_letters + string.digits
    if data.get("symbols", True):
        characters += "!@#$%&*_-+="

    password = "".join(
        secrets.choice(characters)
        for _ in range(length)
    )

    return jsonify({
        "password": password,
        "success": True,
    }), 200


# ==================================================
# JSON FORMATTER
# ==================================================

@app.route("/api/format-json", methods=["POST"])
def api_format_json():
    data = request.get_json(silent=True) or {}

    raw_json = (
        data.get("json")
        or data.get("text")
        or data.get("content")
        or ""
    )

    if not isinstance(raw_json, str) or not raw_json.strip():
        return jsonify({
            "error": "الصق نص JSON أولًا."
        }), 400

    if len(raw_json) > 500000:
        return jsonify({
            "error": "نص JSON كبير جدًا."
        }), 400

    try:
        parsed = json.loads(raw_json)

        formatted = json.dumps(
            parsed,
            ensure_ascii=False,
            indent=4
        )

        return jsonify({
            "formatted": formatted,
            "result": formatted,
            "success": True,
            "valid": True,
        }), 200

    except json.JSONDecodeError as error:
        return jsonify({
            "error": (
                f"JSON غير صحيح في السطر {error.lineno} "
                f"والعمود {error.colno}: {error.msg}"
            ),
            "success": False,
            "valid": False,
        }), 400


# ==================================================
# ERROR HANDLERS
# ==================================================

@app.errorhandler(413)
def request_too_large(error):
    return jsonify({
        "error": "حجم الطلب أكبر من المسموح به."
    }), 413


@app.errorhandler(404)
def page_not_found(error):
    if request.path.startswith("/api/"):
        return jsonify({
            "error": "مسار API غير موجود."
        }), 404

    return "الصفحة غير موجودة.", 404


@app.errorhandler(500)
def internal_server_error(error):
    app.logger.exception("Internal server error")

    return jsonify({
        "error": "حدث خطأ داخلي في CodeBox Pro."
    }), 500


# ==================================================
# RUN APPLICATION
# ==================================================

if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=int(os.getenv("PORT", "5000")),
        debug=False,
    )
