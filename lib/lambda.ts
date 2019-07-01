import { Construct, Duration } from '@aws-cdk/core';
import lambda = require('@aws-cdk/aws-lambda');
import { IWatchful } from './api';
import cloudwatch = require('@aws-cdk/aws-cloudwatch');

const DEFAULT_DURATION_THRESHOLD_PERCENT = 80;

export interface WatchLambdaFunctionOptions {
  /**
   * Number of allowed errors per minute. If there are more errors than that, an alarm will trigger.
   *
   * @default 0
   */
  readonly errorsPerMinuteThreshold?: number;

  /**
   * Number of allowed throttles per minute.
   *
   * @default 0
   */
  readonly throttlesPerMinuteThreshold?: number;

  /**
   * Threshold for the duration alarm as percentage of the function's timeout
   * value.
   *
   * If this is set to 50%, the alarm will be set when p99 latency of the
   * function exceeds 50% of the function's timeout setting.
   *
   * @default 80
   */
  readonly durationThresholdPercent?: number;
}

export interface WatchLambdaFunctionProps extends WatchLambdaFunctionOptions {
  readonly title: string;
  readonly watchful: IWatchful;
  readonly fn: lambda.Function;
}

export class WatchLambdaFunction extends Construct {

  private readonly watchful: IWatchful;
  private readonly fn: lambda.Function;

  constructor(scope: Construct, id: string, props: WatchLambdaFunctionProps) {
    super(scope, id);

    const cfnFunction = props.fn.node.defaultChild as lambda.CfnFunction;
    const timeoutSec = cfnFunction.timeout || 3;

    this.watchful = props.watchful;
    this.fn = props.fn;

    this.watchful.addSection(props.title, {
      links: [
        { title: 'AWS Lambda Console', url: linkForLambdaFunction(this.fn) }
      ]
    });

    const { errorsMetric,    errorsAlarm    } = this.createErroesMonitor(props.errorsPerMinuteThreshold);
    const { throttlesMetric, throttlesAlarm } = this.createThrottlesMonitor(props.throttlesPerMinuteThreshold);
    const { durationMetric,  durationAlarm  } = this.createDurationMonitor(timeoutSec, props.durationThresholdPercent);

    this.watchful.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Invocations',
        width: 6,
        left: [ this.fn.metricInvocations() ]
      }),
      new cloudwatch.GraphWidget({
        title: 'Errors',
        width: 6,
        left: [ errorsMetric ],
        leftAnnotations: [ errorsAlarm.toAnnotation() ]
      }),
      new cloudwatch.GraphWidget({
        title: 'Throttles',
        width: 6,
        left: [ throttlesMetric ],
        leftAnnotations: [ throttlesAlarm.toAnnotation() ]
      }),
      new cloudwatch.GraphWidget({
        title: 'Duration',
        width: 6,
        left: [ durationMetric ],
        leftAnnotations: [ durationAlarm.toAnnotation() ]
      }),
    )
  }

  private createErroesMonitor(errorsPerMinuteThreshold = 0) {
    const fn = this.fn;
    const errorsMetric = fn.metricErrors();
    const errorsAlarm = errorsMetric.createAlarm(this, 'ErrorsAlarm', {
      alarmDescription: `Over ${errorsPerMinuteThreshold} errors per minute`,
      threshold: errorsPerMinuteThreshold,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 3,
      period: Duration.minutes(1),
    });
    this.watchful.addAlarm(errorsAlarm);
    return { errorsMetric, errorsAlarm };
  }

  private createThrottlesMonitor(throttlesPerMinuteThreshold = 0) {
    const fn = this.fn;
    const throttlesMetric = fn.metricThrottles();
    const throttlesAlarm = throttlesMetric.createAlarm(this, 'ThrottlesAlarm', {
      alarmDescription: `Over ${throttlesPerMinuteThreshold} throttles per minute`,
      threshold: throttlesPerMinuteThreshold,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 3,
      period: Duration.minutes(1)
    });
    this.watchful.addAlarm(throttlesAlarm);
    return { throttlesMetric, throttlesAlarm };
  }

  private createDurationMonitor(timeoutSec: number, durationPercentThreshold: number = DEFAULT_DURATION_THRESHOLD_PERCENT) {
    const fn = this.fn;
    const durationMetric = fn.metricDuration();
    const durationThresholdSec = Math.floor(durationPercentThreshold / 100 * timeoutSec);
    const durationAlarm = durationMetric.createAlarm(this, 'DurationAlarm', {
      alarmDescription: `p99 latency >= ${durationThresholdSec}s (${durationPercentThreshold}%)`,
      threshold: durationThresholdSec * 1000, // milliseconds
      period: Duration.minutes(1),
      evaluationPeriods: 3,
    });
    this.watchful.addAlarm(durationAlarm);
    return { durationMetric, durationAlarm };
  }
}

function linkForLambdaFunction(fn: lambda.Function, tab = 'graph') {
  return `https://console.aws.amazon.com/lambda/home?region=${fn.stack.region}#/functions/${fn.functionName}?tab=${tab}`;
}