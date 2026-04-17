use crate::evaluator::EvalResult;
use crate::ir::{ForeignAbi, ForeignBindingSpec, QuintError, QuintId};
use crate::value::Value;
use fxhash::FxHashMap;
use libffi::middle::{arg, Cif, CodePtr, Type};
use libloading::Library;
use std::ffi::{c_char, c_void, CStr, CString};
use std::rc::Rc;

pub type ForeignBindingRegistry = FxHashMap<QuintId, Rc<ForeignBinding>>;

pub struct ForeignBinding {
    spec: ForeignBindingSpec,
    _library: Library,
    call: ForeignFunction,
    free: Option<ForeignFreeFunction>,
}

struct ForeignFunction {
    cif: Cif,
    code_ptr: CodePtr,
    args: Vec<ForeignAbi>,
    result: ForeignAbi,
}

struct ForeignFreeFunction {
    cif: Cif,
    code_ptr: CodePtr,
}

enum OwnedArg {
    Int(i64),
    Bool(u8),
    Str(CString),
}

impl OwnedArg {
    fn as_arg(&self) -> libffi::middle::Arg {
        match self {
            OwnedArg::Int(value) => arg(value),
            OwnedArg::Bool(value) => arg(value),
            OwnedArg::Str(value) => {
                let ptr = value.as_ptr();
                arg(&ptr)
            }
        }
    }
}

impl ForeignBinding {
    pub fn invoke(&self, args: Vec<Value>) -> EvalResult {
        if args.len() != self.call.args.len() {
            return Err(QuintError::new(
                "QNT522",
                &format!(
                    "FFI binding {}.{} expected {} arguments but received {}",
                    self.spec.module,
                    self.spec.name,
                    self.call.args.len(),
                    args.len()
                ),
            ));
        }

        let mut native_args = Vec::with_capacity(args.len());
        for (value, abi) in args.iter().zip(&self.call.args) {
            native_args.push(self.encode_arg(value, abi)?);
        }
        let ffi_args = native_args.iter().map(OwnedArg::as_arg).collect::<Vec<_>>();

        unsafe {
            match self.call.result {
                ForeignAbi::Int => {
                    let result: i64 = self.call.cif.call(self.call.code_ptr, &ffi_args);
                    Ok(Value::int(result))
                }
                ForeignAbi::Bool => {
                    let result: u8 = self.call.cif.call(self.call.code_ptr, &ffi_args);
                    match result {
                        0 => Ok(Value::bool(false)),
                        1 => Ok(Value::bool(true)),
                        _ => Err(QuintError::new(
                            "QNT523",
                            &format!(
                                "FFI binding {}.{} returned an invalid boolean value",
                                self.spec.module, self.spec.name
                            ),
                        )),
                    }
                }
                ForeignAbi::Str => {
                    let result_ptr: *const c_char = self.call.cif.call(self.call.code_ptr, &ffi_args);
                    self.decode_string_result(result_ptr)
                }
            }
        }
    }

    fn encode_arg(&self, value: &Value, abi: &ForeignAbi) -> Result<OwnedArg, QuintError> {
        match abi {
            ForeignAbi::Int => Ok(OwnedArg::Int(value.as_int())),
            ForeignAbi::Bool => Ok(OwnedArg::Bool(if value.as_bool() { 1 } else { 0 })),
            ForeignAbi::Str => CString::new(value.as_str().as_str())
                .map(OwnedArg::Str)
                .map_err(|_| {
                    QuintError::new(
                        "QNT527",
                        &format!(
                            "FFI binding {}.{} cannot pass strings containing interior NUL bytes",
                            self.spec.module, self.spec.name
                        ),
                    )
                }),
        }
    }

    unsafe fn decode_string_result(&self, result_ptr: *const c_char) -> EvalResult {
        if result_ptr.is_null() {
            return Err(QuintError::new(
                "QNT523",
                &format!(
                    "FFI binding {}.{} returned a null string pointer",
                    self.spec.module, self.spec.name
                ),
            ));
        }

        let decoded = CStr::from_ptr(result_ptr).to_str().map(|text| Value::str(text.into()));

        if let Some(free) = &self.free {
            let ptr = result_ptr as *mut c_void;
            free.call(ptr);
        }

        decoded.map_err(|_| {
            QuintError::new(
                "QNT523",
                &format!(
                    "FFI binding {}.{} returned a non-UTF-8 string",
                    self.spec.module, self.spec.name
                ),
            )
        })
    }
}

impl ForeignFreeFunction {
    unsafe fn call(&self, ptr: *mut c_void) {
        self.cif.call::<()>(self.code_ptr, &[arg(&ptr)]);
    }
}

pub fn load_foreign_bindings(specs: &[ForeignBindingSpec]) -> Result<ForeignBindingRegistry, QuintError> {
    let mut bindings = FxHashMap::default();

    for spec in specs {
        if bindings.contains_key(&spec.id) {
            return Err(QuintError::new(
                "QNT519",
                &format!("Duplicate foreign binding for {}.{}", spec.module, spec.name),
            ));
        }

        let library = unsafe {
            Library::new(&spec.library).map_err(|error| {
                QuintError::new(
                    "QNT520",
                    &format!(
                        "Failed to load FFI binding {}.{}: {}",
                        spec.module, spec.name, error
                    ),
                )
            })?
        };

        let call = unsafe { load_function(&library, spec)? };
        let free = if let Some(free_symbol) = &spec.free_symbol {
            Some(unsafe { load_free_function(&library, spec, free_symbol)? })
        } else {
            None
        };

        bindings.insert(
            spec.id,
            Rc::new(ForeignBinding {
                spec: spec.clone(),
                _library: library,
                call,
                free,
            }),
        );
    }

    Ok(bindings)
}

unsafe fn load_function(library: &Library, spec: &ForeignBindingSpec) -> Result<ForeignFunction, QuintError> {
    let symbol = library
        .get::<*mut c_void>(spec.symbol.as_bytes())
        .map_err(|error| {
            QuintError::new(
                "QNT520",
                &format!(
                    "FFI symbol {} was not loaded for {}.{}: {}",
                    spec.symbol, spec.module, spec.name, error
                ),
            )
        })?;

    let cif = Cif::new(spec.args.iter().map(ffi_type_for_abi).collect::<Vec<_>>(), ffi_type_for_abi(&spec.result));

    Ok(ForeignFunction {
        cif,
        code_ptr: CodePtr(*symbol),
        args: spec.args.clone(),
        result: spec.result.clone(),
    })
}

unsafe fn load_free_function(
    library: &Library,
    spec: &ForeignBindingSpec,
    symbol_name: &str,
) -> Result<ForeignFreeFunction, QuintError> {
    let symbol = library
        .get::<*mut c_void>(symbol_name.as_bytes())
        .map_err(|error| {
            QuintError::new(
                "QNT520",
                &format!(
                    "FFI symbol {} was not loaded for {}.{}: {}",
                    symbol_name, spec.module, spec.name, error
                ),
            )
        })?;

    Ok(ForeignFreeFunction {
        cif: Cif::new(vec![Type::pointer()], Type::void()),
        code_ptr: CodePtr(*symbol),
    })
}

fn ffi_type_for_abi(abi: &ForeignAbi) -> Type {
    match abi {
        ForeignAbi::Int => Type::i64(),
        ForeignAbi::Bool => Type::u8(),
        ForeignAbi::Str => Type::pointer(),
    }
}
