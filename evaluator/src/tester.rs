use crate::evaluator::{Env, Interpreter};
use crate::ir::{ForeignBindingSpec, LookupDefinition, LookupTable, QuintError};
use crate::itf::Trace;
use crate::progress::Reporter;
use crate::tap;
use crate::verbosity::Verbosity;
use serde::Serialize;

/// A test case that can be executed
pub struct TestCase {
    pub name: String,
    pub test_def: LookupDefinition,
    pub table: LookupTable,
    pub foreign_bindings: Vec<ForeignBindingSpec>,
}

/// Status of a test execution
#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TestStatus {
    Passed,
    Failed,
    Ignored,
}

/// Result of executing a single test
pub struct TestResult {
    pub name: String,
    pub status: TestStatus,
    pub errors: Vec<QuintError>,
    pub seed: u64,
    pub nsamples: usize,
    pub traces: Vec<Trace>,
}

impl TestCase {
    /// Execute this test case with the given seed and maximum samples
    ///
    /// If `seed` is provided, it will be used to initialize the random number generator
    /// for reproducibility. Otherwise, a random seed will be generated.
    ///
    /// Tests are run repeatedly up to `max_samples` times. If the RNG state
    /// repeats (indicating a deterministic test), execution stops early.
    pub fn execute<R: Reporter>(
        &self,
        seed: Option<u64>,
        max_samples: usize,
        mut reporter: R,
        verbosity: Verbosity,
        tap: bool,
    ) -> TestResult {
        let test_name = &self.name;

        let mut interpreter = match Interpreter::with_var_storage_and_bindings(
            self.table.clone(),
            std::rc::Rc::new(std::cell::RefCell::new(crate::storage::Storage::default())),
            self.foreign_bindings.clone(),
        ) {
            Ok(interpreter) => interpreter,
            Err(error) => {
                return TestResult {
                    name: test_name.clone(),
                    traces: vec![],
                    status: TestStatus::Failed,
                    errors: vec![error],
                    seed: 0,
                    nsamples: 0,
                }
            }
        };
        let mut env = match seed {
            Some(s) => Env::with_rand_state_and_tap(interpreter.var_storage.clone(), s, verbosity, tap),
            None => Env::new_with_tap(interpreter.var_storage.clone(), verbosity, tap),
        };

        let seed = env.rand.get_state();

        // Compile the test definition (not just the expression)
        // This ensures instance overrides are applied via compile_under_context
        let compiled_test = interpreter.compile_def(&self.test_def);
        let test_def_id = self.test_def.id();

        let mut errors = Vec::new();
        let mut nsamples = 0;
        let mut trace = Trace {
            states: Vec::new(),
            violation: false,
            seed,
        };

        for _ in 0..max_samples {
            let prev_rng_state = env.rand.get_state();

            reporter.next_sample();
            let _trace_scope = tap::trace_scope(tap);
            nsamples += 1;

            let test_result = compiled_test.execute(&mut env);
            env.shift();

            trace.states = std::mem::take(&mut env.trace);

            match test_result {
                Ok(result) => {
                    if !result.as_bool() {
                        let error =
                            QuintError::new("QNT511", &format!("Test {test_name} returned false"))
                                .with_reference(test_def_id);
                        errors.push(error);
                        trace.violation = true;
                        break;
                    }
                    if env.rand.get_state() == prev_rng_state {
                        break;
                    }
                }
                Err(e) => {
                    errors.push(e);
                    break;
                }
            }
        }

        let status = if errors.is_empty() {
            TestStatus::Passed
        } else {
            TestStatus::Failed
        };

        TestResult {
            name: test_name.clone(),
            traces: vec![trace],
            status,
            errors,
            seed,
            nsamples,
        }
    }
}
